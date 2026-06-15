import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Server, Download, Check, FileCode, ChevronRight, Save, Usb, Wifi, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';
import { useLanguage } from '../context/LanguageContext';
import { DeploymentTarget, fetchDeploymentHistory, generateDeploymentBundle, generateDeploymentConfig, getDeploymentDownloadUrl, saveDeploymentConfig } from '../services/api';
import { ConsoleEmptyState, ConsolePage, ConsolePanel } from '../components/ConsolePrimitives';

// Web Serial API type declarations
interface SerialPort {
    readable: ReadableStream | null;
    writable: WritableStream | null;
    open(options: { baudRate: number }): Promise<void>;
    close(): Promise<void>;
    getInfo(): { usbVendorId?: number; usbProductId?: number };
}

interface Serial {
    requestPort(): Promise<SerialPort>;
    getPorts(): Promise<SerialPort[]>;
}

declare global {
    interface Navigator {
        serial?: Serial;
    }
}

const getSerial = (): Serial | undefined => navigator.serial;

interface GeneratedConfig {
    configText: string;
    envSnippet: string;
    checksum: string;
    warnings: string[];
}

const CHUNK_SIZE = 768; // base64 chunk size to stay under serial line buffer
const CHUNK_DELAY_MS = 50;

const deploymentTargets: DeploymentTarget[] = ['nginx', 'apache', 'caddy', 'docker_compose', 'binary_agent', 'k8s_daemonset'];

const DeploymentWizard = () => {
    const { t } = useLanguage();
    const [step, setStep] = useState(1);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [serverType, setServerType] = useState<DeploymentTarget | null>(null);
    const [generated, setGenerated] = useState<GeneratedConfig | null>(null);
    const [savedId, setSavedId] = useState<string | null>(null);
    const [history, setHistory] = useState<any[]>([]);
    const [config, setConfig] = useState({
        port: '8080',
        serverName: 'api.example.com',
        rateLimit: '100',
        upstream: 'http://backend:3005',
    });

    // Step 4: Device write state
    const [serialSupported, setSerialSupported] = useState(false);
    const [serialPort, setSerialPort] = useState<SerialPort | null>(null);
    const [serialConnected, setSerialConnected] = useState(false);
    const [writingBundle, setWritingBundle] = useState(false);
    const [writeProgress, setWriteProgress] = useState(0);
    const [writePhase, setWritePhase] = useState<string>('');
    const writerRef = useRef<WritableStreamDefaultWriter | null>(null);
    const readerRef = useRef<ReadableStreamDefaultReader | null>(null);

    useEffect(() => {
        setSerialSupported(!!getSerial());
    }, []);

    const handleNext = async () => {
        if (step === 1) {
            setStep(2);
            return;
        }
        if (step === 2) {
            await doGenerate();
        }
    };

    const handleBack = () => {
        setError(null);
        setStep((prev) => Math.max(1, prev - 1));
    };

    const doGenerate = async () => {
        if (!serverType) return;
        setError(null);
        setLoading(true);
        try {
            const response = await generateDeploymentConfig({
                serverType,
                profile: {
                    port: Number(config.port),
                    serverName: config.serverName,
                    rateLimit: Number(config.rateLimit),
                    upstream: config.upstream,
                },
            });
            setGenerated(response.data);
            setStep(3);
        } catch (e: any) {
            setError(e.message || t('deploymentWizard.generate_failed'));
        } finally {
            setLoading(false);
        }
    };

    const doSave = async () => {
        if (!serverType || !generated) return;
        setSaving(true);
        setError(null);
        try {
            const response = await saveDeploymentConfig({
                serverType,
                profile: {
                    port: Number(config.port),
                    serverName: config.serverName,
                    rateLimit: Number(config.rateLimit),
                    upstream: config.upstream,
                },
                configText: generated.configText,
                envSnippet: generated.envSnippet,
                name: `${serverType}-${config.serverName}`,
            });
            setSavedId(response.data.deploymentId);
            await loadHistory();
        } catch (e: any) {
            setError(e.message || t('deploymentWizard.save_failed'));
        } finally {
            setSaving(false);
        }
    };

    const loadHistory = async () => {
        try {
            const rows = await fetchDeploymentHistory(undefined, 10);
            setHistory(rows);
        } catch {
            setHistory([]);
        }
    };

    // --- Web Serial API for direct browser-to-hardware transfer ---
    const connectSerial = useCallback(async () => {
        if (!serialSupported) return;
        setError(null);
        try {
            const serial = getSerial();
            if (!serial) return;
            const port = await serial.requestPort();
            await port.open({ baudRate: 115200 });
            setSerialPort(port);
            setSerialConnected(true);

            // Start reading responses
            const reader = port.readable!.getReader();
            readerRef.current = reader;
            readSerialLoop(reader);
        } catch (e: any) {
            setError(e.message || t('deploymentWizard.serial_connect_failed'));
            setSerialConnected(false);
        }
    }, [serialSupported]);

    const disconnectSerial = useCallback(async () => {
        try {
            readerRef.current?.cancel();
            writerRef.current?.releaseLock();
            await serialPort?.close();
        } catch { /* ignore */ }
        setSerialPort(null);
        setSerialConnected(false);
        readerRef.current = null;
        writerRef.current = null;
    }, [serialPort]);

    const readSerialLoop = async (reader: ReadableStreamDefaultReader) => {
        const decoder = new TextDecoder();
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                // Read and discard device responses (value is Uint8Array from serial)
                decoder.decode(value as Uint8Array);
            }
        } catch { /* port closed */ }
    };

    const sendSerialLine = async (text: string) => {
        if (!serialPort?.writable) return;
        const writer = serialPort.writable.getWriter();
        writerRef.current = writer;
        const encoder = new TextEncoder();
        await writer.write(encoder.encode(text + '\n'));
        writer.releaseLock();
        writerRef.current = null;
    };

    // LEGACY SERIAL WRITE PATH (deprecated): This callback drives the retired ESP32 serial-deployer
    // dongle flow (AG:REQ:WRITE_BUNDLE USB-TTL protocol, archived 2026-06-13). The active hardware is the
    // AetherGuard Root-Resistant Gateway Appliance (STM32H5/U5, newline-JSON protocol). The function name
    // `doWriteToEsp32` and testid `deploy-write-esp32` are retained for backward-compat with any legacy-registered
    // device still using the serial path; do not extend. New deployments should target the Gateway Appliance flow.
    const doWriteToEsp32 = useCallback(async () => {
        if (!serverType || !serialConnected) return;

        setWritingBundle(true);
        setWriteProgress(0);
        setWritePhase('generating');
        setError(null);

        try {
            // Step 1: Generate bundle via backend API
            const bundleResponse = await generateDeploymentBundle({
                serverType,
                profile: {
                    port: Number(config.port),
                    serverName: config.serverName,
                    rateLimit: Number(config.rateLimit),
                    upstream: config.upstream,
                },
                deploymentId: savedId || undefined,
            });

            if (!bundleResponse.success || !bundleResponse.data?.bundleBase64) {
                throw new Error(bundleResponse.error || t('deploymentWizard.generate_failed'));
            }

            const bundle = bundleResponse.data;

            // Decode base64 to raw bytes
            const bundleBytes = atob(bundle.bundleBase64);
            const totalSize = bundleBytes.length;

            // Step 2: Send WRITE_BUNDLE command to hardware device
            setWritePhase('initiating');
            const filename = `deploy-${serverType}.sh`;
            await sendSerialLine(`AG:REQ:WRITE_BUNDLE:${totalSize}:${filename}`);

            // Wait for AG:ACK:WRITE_BUNDLE:READY
            await sleep(500);

            // Step 3: Send data in base64 chunks
            setWritePhase('transferring');
            const totalChunks = Math.ceil(bundle.bundleBase64.length / CHUNK_SIZE);
            for (let i = 0; i < totalChunks; i++) {
                const chunk = bundle.bundleBase64.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
                await sendSerialLine(`AG:CHUNK:${chunk}`);
                setWriteProgress(Math.round(((i + 1) / totalChunks) * 90));
                if (i < totalChunks - 1) {
                    await sleep(CHUNK_DELAY_MS);
                }
            }

            // Step 4: Signal end of bundle
            setWritePhase('finalizing');
            await sendSerialLine('AG:END_BUNDLE');
            setWriteProgress(100);
            setWritePhase('complete');
        } catch (e: any) {
            setError(e.message || t('deploymentWizard.write_failed'));
            setWritePhase('error');
        } finally {
            setWritingBundle(false);
        }
    }, [serverType, serialConnected, config, savedId]);

    useEffect(() => {
        loadHistory();
        return () => {
            disconnectSerial();
        };
    }, []);

    const steps = [
        { n: 1, label: t('deploy.step1') },
        { n: 2, label: t('deploy.step2') },
        { n: 3, label: t('deploy.step3') },
        { n: 4, label: t('deploymentWizard.step4_write') },
    ];

    return (
        <ConsolePage title={t('deploy.title')} subtitle={t('deploymentWizard.page_subtitle')}>
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
                <ConsolePanel title={t('deploymentWizard.wizard_title')} subtitle={t('deploymentWizard.wizard_subtitle')} icon={Server} iconTone="primary" className="xl:col-span-2">
                    {/* Step indicator */}
                    <div className="relative mb-12 flex items-center justify-between">
                        <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-border" />
                        {steps.map((s) => (
                            <div key={s.n} className="relative z-10 flex flex-col items-center gap-2 bg-card px-2">
                                <div
                                    className={clsx(
                                        'flex h-8 w-8 items-center justify-center rounded-full border text-sm font-bold transition-all',
                                        step >= s.n ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-muted text-muted-foreground',
                                    )}
                                >
                                    {step > s.n ? <Check size={14} /> : s.n}
                                </div>
                                <span className="whitespace-nowrap text-xs font-medium text-muted-foreground">{s.label}</span>
                            </div>
                        ))}
                    </div>

                    {error && <div className="mb-4 rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-600 dark:text-rose-300">{error}</div>}

                    {/* Step 1: Select server type */}
                    {step === 1 && (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
                            <h2 className="mb-6 text-lg font-medium text-foreground">{t('deploy.select_server')}</h2>
                            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                                {deploymentTargets.map((type) => (
                                    <div
                                        key={type}
                                        data-testid={`deploy-target-${type}`}
                                        onClick={() => setServerType(type)}
                                        className={clsx(
                                            'flex cursor-pointer flex-col items-center gap-4 rounded-xl border p-6 transition-colors',
                                            serverType === type ? 'border-primary bg-primary/5' : 'border-border bg-muted/15 hover:bg-muted/25',
                                        )}
                                    >
                                        <Server size={48} className={serverType === type ? 'text-primary' : 'text-muted-foreground'} />
                                        <span className="text-base font-medium capitalize text-foreground">{type}</span>
                                    </div>
                                ))}
                            </div>
                        </motion.div>
                    )}

                    {/* Step 2: Configure parameters */}
                    {step === 2 && (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                            <h2 className="text-lg font-medium text-foreground">{t('deploy.configure_middleware')}</h2>
                            <div className="grid grid-cols-1 gap-6">
                                <div>
                                    <label className="mb-2 block text-xs text-muted-foreground">{t('deploy.listen_port')}</label>
                                    <input
                                        data-testid="deploy-port"
                                        type="text"
                                        value={config.port}
                                        onChange={(e) => setConfig({ ...config, port: e.target.value })}
                                        className="w-full rounded-lg border border-border bg-muted/20 px-4 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="mb-2 block text-xs text-muted-foreground">{t('deploy.server_name')}</label>
                                    <input
                                        data-testid="deploy-server-name"
                                        type="text"
                                        value={config.serverName}
                                        onChange={(e) => setConfig({ ...config, serverName: e.target.value })}
                                        className="w-full rounded-lg border border-border bg-muted/20 px-4 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="mb-2 block text-xs text-muted-foreground">{t('deploy.rate_limit')}</label>
                                    <input
                                        data-testid="deploy-rate-limit"
                                        type="text"
                                        value={config.rateLimit}
                                        onChange={(e) => setConfig({ ...config, rateLimit: e.target.value })}
                                        className="w-full rounded-lg border border-border bg-muted/20 px-4 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="mb-2 block text-xs text-muted-foreground">{t('wizard.upstream')}</label>
                                    <input
                                        data-testid="deploy-upstream"
                                        type="text"
                                        value={config.upstream}
                                        onChange={(e) => setConfig({ ...config, upstream: e.target.value })}
                                        className="w-full rounded-lg border border-border bg-muted/20 px-4 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                                    />
                                </div>
                            </div>
                        </motion.div>
                    )}

                    {/* Step 3: Preview generated config */}
                    {step === 3 && generated && (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                            <div className="mb-4 text-center">
                                <div className="mb-4 inline-flex rounded-full border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-600 dark:text-emerald-400">
                                    <FileCode size={48} />
                                </div>
                                <h2 className="text-xl font-bold text-foreground">{t('deploy.config_ready')}</h2>
                                <p className="mt-2 text-sm text-muted-foreground">{t('deploy.config_desc')}</p>
                            </div>

                            {generated.warnings.length > 0 && (
                                <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-300">
                                    <div className="flex items-center gap-2 font-medium"><AlertTriangle size={14} /> {t('deploymentWizard.warnings')}</div>
                                    <ul className="mt-1 ml-5 list-disc">{generated.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
                                </div>
                            )}

                            <div className="text-xs text-muted-foreground">
                                {t('deploymentWizard.checksum')}: <span className="font-mono">{generated.checksum}</span>
                            </div>
                            <div className="overflow-x-auto rounded-xl border border-border bg-muted/20 p-6 font-mono text-xs text-foreground">
                                <pre>{generated.configText}</pre>
                                <div className="my-4 border-t border-border"></div>
                                <pre>{generated.envSnippet}</pre>
                            </div>
                        </motion.div>
                    )}

                    {/* Step 4: Write to device / download */}
                    {step === 4 && generated && (
                        <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                            <div className="mb-4 text-center">
                                <div className="mb-4 inline-flex rounded-full border border-blue-500/20 bg-blue-500/10 p-4 text-blue-600 dark:text-blue-400">
                                    <Usb size={48} />
                                </div>
                                <h2 className="text-xl font-bold text-foreground">{t('deploymentWizard.step4_title')}</h2>
                                <p className="mt-2 text-sm text-muted-foreground">{t('deploymentWizard.step4_desc')}</p>
                            </div>

                            {/* Serial connection status */}
                            <div className="rounded-xl border border-border p-4 space-y-4">
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className={clsx('h-3 w-3 rounded-full', serialConnected ? 'bg-emerald-500' : 'bg-muted-foreground/30')} />
                                        <span className="text-sm font-medium text-foreground">
                                            {serialConnected ? t('deploymentWizard.serial_connected') : t('deploymentWizard.serial_disconnected')}
                                        </span>
                                    </div>
                                    {!serialSupported && (
                                        <span className="text-xs text-amber-600 dark:text-amber-400">{t('deploymentWizard.serial_not_supported')}</span>
                                    )}
                                </div>

                                {!serialConnected ? (
                                    <button
                                        data-testid="deploy-connect-serial"
                                        onClick={connectSerial}
                                        disabled={!serialSupported}
                                        className={clsx(
                                            'flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium transition-colors',
                                            serialSupported
                                                ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                                                : 'cursor-not-allowed bg-muted text-muted-foreground'
                                        )}
                                    >
                                        <Wifi size={16} /> {t('deploymentWizard.connect_serial')}
                                    </button>
                                ) : (
                                    <div className="space-y-3">
                                        <button
                                            data-testid="deploy-disconnect-serial"
                                            onClick={disconnectSerial}
                                            className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-muted/20 px-4 py-2 text-sm text-muted-foreground hover:bg-muted/30"
                                        >
                                            {t('deploymentWizard.disconnect_serial')}
                                        </button>

                                        {/* Write to hardware device */}
                                        <button
                                            data-testid="deploy-write-esp32"
                                            onClick={doWriteToEsp32}
                                            disabled={writingBundle}
                                            className={clsx(
                                                'flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium transition-colors',
                                                writingBundle
                                                    ? 'cursor-not-allowed bg-primary/50 text-primary-foreground'
                                                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                                            )}
                                        >
                                            <Usb size={16} />
                                            {writingBundle
                                                ? t('deploymentWizard.writing_bundle')
                                                : t('deploymentWizard.write_to_device')
                                            }
                                        </button>

                                        {/* Progress bar */}
                                        {(writingBundle || writeProgress > 0) && (
                                            <div className="space-y-2">
                                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                                    <span>{writePhase === 'generating' && t('deploymentWizard.phase_generating')}
                                                        {writePhase === 'initiating' && t('deploymentWizard.phase_initiating')}
                                                        {writePhase === 'transferring' && t('deploymentWizard.phase_transferring')}
                                                        {writePhase === 'finalizing' && t('deploymentWizard.phase_finalizing')}
                                                        {writePhase === 'complete' && t('deploymentWizard.phase_complete')}
                                                        {writePhase === 'error' && t('deploymentWizard.phase_error')}
                                                    </span>
                                                    <span>{writeProgress}%</span>
                                                </div>
                                                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                                                    <div
                                                        className={clsx('h-full rounded-full transition-all duration-300',
                                                            writePhase === 'error' ? 'bg-rose-500' :
                                                            writePhase === 'complete' ? 'bg-emerald-500' : 'bg-primary'
                                                        )}
                                                        style={{ width: `${writeProgress}%` }}
                                                    />
                                                </div>
                                            </div>
                                        )}

                                        {writePhase === 'complete' && (
                                            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-600 dark:text-emerald-300">
                                                {t('deploymentWizard.write_success')}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Alternative: download bundle file */}
                            <div className="rounded-xl border border-border p-4">
                                <h3 className="mb-2 text-sm font-medium text-foreground">{t('deploymentWizard.alternative_download')}</h3>
                                <p className="mb-3 text-xs text-muted-foreground">{t('deploymentWizard.alternative_download_desc')}</p>
                                <a
                                    data-testid="deploy-download-bundle"
                                    href={savedId ? getDeploymentDownloadUrl(savedId, 'bundle') : '#'}
                                    className={clsx(
                                        'flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500',
                                        !savedId && 'pointer-events-none opacity-50'
                                    )}
                                >
                                    <Download size={16} /> {t('wizard.download')}
                                </a>
                                {!savedId && (
                                    <p className="mt-2 text-xs text-muted-foreground">{t('deploymentWizard.save_first_hint')}</p>
                                )}
                            </div>
                        </motion.div>
                    )}

                    {/* Navigation buttons */}
                    <div className="mt-8 flex justify-between border-t border-border pt-6">
                        <button
                            data-testid="deploy-back"
                            onClick={handleBack}
                            disabled={step === 1 || loading || saving}
                            className={clsx('rounded-lg px-4 py-2 text-sm font-medium transition-colors', step === 1 ? 'cursor-not-allowed text-muted-foreground' : 'text-muted-foreground hover:bg-muted/30 hover:text-foreground')}
                        >
                            {t('deploy.back')}
                        </button>

                        {step < 3 ? (
                            <button
                                data-testid="deploy-next"
                                onClick={handleNext}
                                disabled={(step === 1 && !serverType) || loading}
                                className={clsx(
                                    'flex items-center gap-2 rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-colors',
                                    (step === 1 && !serverType) || loading ? 'cursor-not-allowed opacity-50' : 'hover:bg-primary/90',
                                )}
                            >
                                {loading ? t('wizard.generating') : t('deploy.next')} <ChevronRight size={16} />
                            </button>
                        ) : step === 3 ? (
                            <div className="flex gap-2">
                                <button
                                    data-testid="deploy-save-version"
                                    onClick={doSave}
                                    disabled={saving || !generated}
                                    className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted/30 disabled:opacity-60"
                                >
                                    <Save size={16} /> {saving ? t('wizard.saving') : t('wizard.save_version')}
                                </button>
                                <button
                                    data-testid="deploy-go-device-write"
                                    onClick={() => setStep(4)}
                                    className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                                >
                                    <Usb size={16} /> {t('deploymentWizard.go_to_device_write')}
                                </button>
                                <a
                                    data-testid="deploy-preview-download-bundle"
                                    href={savedId ? getDeploymentDownloadUrl(savedId, 'bundle') : '#'}
                                    className={clsx('flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500', !savedId && 'pointer-events-none opacity-50')}
                                >
                                    <Download size={16} /> {t('wizard.download')}
                                </a>
                            </div>
                        ) : (
                            /* Step 4: back to step 3 or restart */
                            <button
                                data-testid="deploy-start-over"
                                onClick={() => { setStep(1); setServerType(null); setGenerated(null); setSavedId(null); setWriteProgress(0); setWritePhase(''); }}
                                className="flex items-center gap-2 rounded-lg bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                            >
                                {t('deploymentWizard.start_over')}
                            </button>
                        )}
                    </div>
                </ConsolePanel>

                <ConsolePanel title={t('wizard.deployment_history')} subtitle={t('deploymentWizard.history_subtitle')} icon={FileCode} iconTone="neutral">
                    <div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">
                        {history.length === 0 && <ConsoleEmptyState title={t('wizard.no_profiles')} description={t('deploymentWizard.no_saved_configs')} />}
                        {history.map((row: any) => (
                            <div key={row.id} className="rounded-xl border border-border bg-muted/15 p-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <div className="text-sm font-medium text-foreground">{row.name || row.server_type}</div>
                                        <div className="text-xs text-muted-foreground">
                                            v{row.version} / {row.server_type}
                                        </div>
                                    </div>
                                    <a href={getDeploymentDownloadUrl(row.id, 'bundle')} className="text-xs text-primary hover:underline">
                                        {t('wizard.download')}
                                    </a>
                                </div>
                                <div className="mt-2 break-all font-mono text-[10px] text-muted-foreground">{row.checksum}</div>
                                <div className="mt-1 text-[10px] text-muted-foreground">{new Date(row.created_at).toLocaleString()}</div>
                            </div>
                        ))}
                    </div>
                </ConsolePanel>
            </div>
        </ConsolePage>
    );
};

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export default DeploymentWizard;
