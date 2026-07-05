import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import consoleBoardStatus from '../../assets/landing-workshop/console-board-status.png';

/**
 * Landing workshop · Variant C "Terminal Ops" (终端审计风 · 极暗).
 *
 * Mounted at /landing-workshop/terminal only; the production landing at "/"
 * is untouched. The pitch is the interface itself: a boot sequence, a live
 * fail-closed event feed, and the authorization chain rendered the way the
 * operators who buy this product actually see systems — as logs. Log lines
 * mirror real reason codes from the codebase (release_window_expired,
 * counter_replay_or_rollback, policy_digest_mismatch, estop latch).
 */

type Lang = 'en' | 'zh';

const BOOT_LINES = [
    '[ 0.000s ] aetherguard-gateway-daemon v1.0 starting (M1)',
    '[ 0.021s ] bridge: SERVER<->LAN/WAN state=isolated (default)',
    '[ 0.043s ] serial: USART3 115200 8N1 -> M2 STM32H563 controller',
    '[ 0.087s ] secure-element: OPTIGA Trust M present, ECDSA P-256 ready (M3)',
    '[ 0.102s ] interlock: relay=open feedback=open verified (M4)',
    '[ 0.115s ] policy: local signed policy loaded, digest sha256:9f2c...e81a',
    '[ 0.118s ] monotonic high-water: ctrl=1041 daemon=1041 companion=1041',
    '[ 0.121s ] mode: FINAL DEFENSE — isolation is the steady state',
    '[ 0.124s ] ready. releases require the full hardware chain.',
];

const EVENT_LINES = [
    { t: '10:02:11', level: 'DENY', line: 'grant counter=1040 <= high_water=1041 -> counter_replay_or_rollback, bridge stays isolated' },
    { t: '10:02:14', level: 'ALRT', line: 'alert raised severity=critical reason=monotonic_counter_rollback (audited)' },
    { t: '10:07:30', level: 'PASS', line: 'grant sig=OK digest=OK counter=1042 expiry=OK feedback=OK -> release ttl=30s' },
    { t: '10:08:00', level: 'INFO', line: 'release_window_expired -> assert_isolated, relay=open, feedback verified' },
    { t: '10:14:52', level: 'DENY', line: 'policyDigest mismatch (payload!=session summary) -> policy_digest_mismatch, fail-closed' },
    { t: '10:21:05', level: 'STOP', line: 'e-stop pressed -> latched. valid grants refused until controller_clear_estop' },
    { t: '10:23:40', level: 'DENY', line: 'estop latched: grant counter=1043 rejected despite valid signature' },
    { t: '10:24:12', level: 'INFO', line: 'operator reset -> state=ISOLATED (not released). ISO 13850 semantics hold', },
];

const COPY = {
    zh: {
        tag: 'workshop · 终端风',
        login: '进入控制台',
        heroTitle: '# 最后防线不在大屏上,在日志里。',
        heroBody:
            '这台设备的说服力不靠营销页——靠它每一行可审计的输出。下面是真实语义的开机序列与 fail-closed 事件流:拒绝有原因码,放行有全链校验,释放窗口必然过期,急停锁存直到有人到场复位。',
        bootTitle: '$ journalctl -u aetherguard-gateway --boot',
        eventsTitle: '$ agctl events --follow   # fail-closed 事件流(语义与代码同源)',
        chainTitle: '$ agctl chain --explain',
        chain: [
            'M1 gateway-daemon   只能【请求】释放,校验 digest / counter 后转发',
            'M2 stm32-controller 固件内复核 challenge/digest/counter/expiry,默认拒绝',
            'M3 secure-element   ECDSA P-256 验签,私钥不可导出,无签名=无放行',
            'M4 interlock        物理继电器+反馈闭环,反馈不一致立即重新隔离',
        ],
        invTitle: '$ agctl invariants',
        invariants: [
            'policyDigest 跨 4 个服务 + 固件逐字节 === ,任一处不等 => fail-closed',
            'monotonic counter 三套独立高水位,各自严格 > ,重放/回滚必拒',
            'release 携带 TTL 自动回到 isolated,隔离是常态,连通是例外',
            'e-stop 锁存:清除前合法 grant 也拒绝(ISO 13850)',
        ],
        deployTitle: '$ cat DEPLOY.txt',
        deploy: [
            '# 在线:   node scripts/setup.mjs && docker compose up -d --build',
            '# 一键:   sudo bash scripts/install.sh',
            '# 离线:   tar -xzf aetherguard-offline-*.tar.gz && sudo bash install.sh',
            '#         (自包含镜像+校验和+可捆绑 Docker,客户机零外网)',
        ],
        scopeTitle: '$ cat SCOPE.txt   # 诚实边界',
        scope: [
            '! 只覆盖实际经过本机布线的网络链路',
            '! 不含带外 BMC / Wi-Fi / 备用网卡 / 本地控制台',
            '! v1 只断低压网络链路,不切市电',
            '! 量产硬件在环测试进行中,当前为原型阶段',
        ],
        cta: '打开控制台,看真实的审计流',
        back: '← 返回现行首页',
    },
    en: {
        tag: 'workshop · terminal',
        login: 'Open Console',
        heroTitle: '# The last line of defense lives in logs, not billboards.',
        heroBody:
            'This appliance argues its case one auditable line at a time. Below: a boot sequence and a fail-closed event feed with real semantics — every denial has a reason code, every release passed the full chain, every release window expires, and an e-stop latches until a human clears it.',
        bootTitle: '$ journalctl -u aetherguard-gateway --boot',
        eventsTitle: '$ agctl events --follow   # fail-closed feed (semantics mirror the code)',
        chainTitle: '$ agctl chain --explain',
        chain: [
            'M1 gateway-daemon   may only REQUEST a release; validates digest/counter first',
            'M2 stm32-controller re-verifies challenge/digest/counter/expiry in firmware; denies by default',
            'M3 secure-element   ECDSA P-256 signatures; non-exportable keys; no signature, no release',
            'M4 interlock        physical relay + feedback loop; mismatch re-isolates immediately',
        ],
        invTitle: '$ agctl invariants',
        invariants: [
            'policyDigest compared byte-for-byte across 4 services + firmware; any mismatch => fail-closed',
            'three independent monotonic high-water marks, each strictly increasing; replay/rollback denied',
            'every release carries a TTL and returns to isolated; isolation is the steady state',
            'e-stop latches: valid grants are refused until an explicit clear (ISO 13850)',
        ],
        deployTitle: '$ cat DEPLOY.txt',
        deploy: [
            '# online:   node scripts/setup.mjs && docker compose up -d --build',
            '# 1-click:  sudo bash scripts/install.sh',
            '# air-gap:  tar -xzf aetherguard-offline-*.tar.gz && sudo bash install.sh',
            '#           (self-contained images + checksums, optional bundled Docker)',
        ],
        scopeTitle: '$ cat SCOPE.txt   # honest limits',
        scope: [
            '! covers only links physically cabled through the appliance',
            '! out-of-band BMC / Wi-Fi / spare NICs / local console excluded',
            '! v1 cuts the low-voltage network link only, never mains power',
            '! hardware-in-the-loop tests on production units still pending (prototype)',
        ],
        cta: 'Open the console and watch the real audit stream',
        back: '← back to current landing',
    },
} as const;

const levelColor: Record<string, string> = {
    DENY: 'text-red-400',
    ALRT: 'text-amber-400',
    PASS: 'text-emerald-400',
    INFO: 'text-sky-400',
    STOP: 'text-red-500',
};

const LandingTerminal = () => {
    const navigate = useNavigate();
    const [lang, setLang] = useState<Lang>(() =>
        typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en',
    );
    const c = useMemo(() => COPY[lang], [lang]);
    const [bootShown, setBootShown] = useState(0);
    const [eventsShown, setEventsShown] = useState(0);

    useEffect(() => {
        if (bootShown >= BOOT_LINES.length) return;
        const timer = window.setTimeout(() => setBootShown((n) => n + 1), 220);
        return () => window.clearTimeout(timer);
    }, [bootShown]);

    useEffect(() => {
        if (bootShown < BOOT_LINES.length) return;
        if (eventsShown >= EVENT_LINES.length) return;
        const timer = window.setTimeout(() => setEventsShown((n) => n + 1), 650);
        return () => window.clearTimeout(timer);
    }, [bootShown, eventsShown]);

    return (
        <div className="min-h-screen bg-[#070a08] font-mono text-[13px] leading-relaxed text-emerald-100/90">
            {/* Top bar */}
            <header className="sticky top-0 z-40 border-b border-emerald-900/50 bg-[#070a08]/95 backdrop-blur">
                <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-3">
                    <span className="text-emerald-400">
                        aetherguard<span className="text-emerald-700">@final-defense</span>:~$
                        <span className="ml-2 rounded border border-emerald-800 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-emerald-500">
                            {c.tag}
                        </span>
                    </span>
                    <div className="flex items-center gap-3">
                        <button
                            type="button"
                            onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
                            className="border border-emerald-800 px-2 py-0.5 text-[11px] text-emerald-400 transition hover:bg-emerald-900/40"
                        >
                            {lang === 'zh' ? 'EN' : '中文'}
                        </button>
                        <button
                            type="button"
                            onClick={() => navigate('/login')}
                            className="border border-emerald-500 bg-emerald-500/10 px-3 py-0.5 text-[11px] font-bold text-emerald-300 transition hover:bg-emerald-500/25"
                        >
                            {c.login} →
                        </button>
                    </div>
                </div>
            </header>

            <main className="mx-auto w-full max-w-5xl px-5 pb-24">
                {/* Hero */}
                <section className="pt-14">
                    <h1 className="max-w-3xl text-xl font-bold text-emerald-300 md:text-3xl">{c.heroTitle}</h1>
                    <p className="mt-4 max-w-3xl text-emerald-100/70">{c.heroBody}</p>
                </section>

                {/* Boot log */}
                <section className="mt-12">
                    <p className="text-emerald-500">{c.bootTitle}</p>
                    <div className="mt-2 rounded-md border border-emerald-900/60 bg-black/50 p-4">
                        {BOOT_LINES.slice(0, bootShown).map((line) => (
                            <p key={line} className="whitespace-pre-wrap text-emerald-200/80">{line}</p>
                        ))}
                        {bootShown < BOOT_LINES.length && <span className="inline-block h-4 w-2 animate-pulse bg-emerald-400" />}
                    </div>
                </section>

                {/* Event feed */}
                <section className="mt-10">
                    <p className="text-emerald-500">{c.eventsTitle}</p>
                    <div className="mt-2 rounded-md border border-emerald-900/60 bg-black/50 p-4">
                        {EVENT_LINES.slice(0, eventsShown).map((ev) => (
                            <p key={ev.t + ev.level} className="whitespace-pre-wrap">
                                <span className="text-emerald-700">{ev.t}</span>{' '}
                                <span className={`font-bold ${levelColor[ev.level] ?? 'text-emerald-300'}`}>[{ev.level}]</span>{' '}
                                <span className="text-emerald-100/80">{ev.line}</span>
                            </p>
                        ))}
                        {bootShown >= BOOT_LINES.length && eventsShown < EVENT_LINES.length && (
                            <span className="inline-block h-4 w-2 animate-pulse bg-emerald-400" />
                        )}
                    </div>
                </section>

                {/* Board status screenshot, CRT-framed */}
                <section className="mt-10">
                    <p className="text-emerald-500">$ agctl ui board-status --screenshot</p>
                    <div className="relative mt-2 overflow-hidden rounded-md border border-emerald-800/80 bg-black/70 p-2">
                        <img src={consoleBoardStatus} alt="Board status console view" className="w-full rounded-sm opacity-90" />
                        <div
                            aria-hidden
                            className="pointer-events-none absolute inset-0"
                            style={{ background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.14) 0px, rgba(0,0,0,0.14) 1px, transparent 1px, transparent 3px)' }}
                        />
                        <p className="px-2 pb-1 pt-2 text-[11px] text-emerald-600">
                            # real console view — interlock state, counters, and the grant audit trail
                        </p>
                    </div>
                </section>

                {/* Chain + invariants */}
                <section className="mt-10 grid gap-8 md:grid-cols-2">
                    <div>
                        <p className="text-emerald-500">{c.chainTitle}</p>
                        <div className="mt-2 rounded-md border border-emerald-900/60 bg-black/50 p-4">
                            <pre className="whitespace-pre-wrap text-emerald-200/80">{`SERVER ══[bridge]══ LAN/WAN\n            │\n   M1 → M2 → M3 → M4\n            │\n      deny by default`}</pre>
                            <div className="mt-3 space-y-1.5">
                                {c.chain.map((line) => (
                                    <p key={line} className="text-emerald-100/75">{line}</p>
                                ))}
                            </div>
                        </div>
                    </div>
                    <div>
                        <p className="text-emerald-500">{c.invTitle}</p>
                        <div className="mt-2 space-y-1.5 rounded-md border border-emerald-900/60 bg-black/50 p-4">
                            {c.invariants.map((line) => (
                                <p key={line} className="text-emerald-100/75">
                                    <span className="text-emerald-400">✓</span> {line}
                                </p>
                            ))}
                        </div>
                    </div>
                </section>

                {/* Deploy + scope */}
                <section className="mt-10 grid gap-8 md:grid-cols-2">
                    <div>
                        <p className="text-emerald-500">{c.deployTitle}</p>
                        <div className="mt-2 space-y-1.5 rounded-md border border-emerald-900/60 bg-black/50 p-4">
                            {c.deploy.map((line) => (
                                <p key={line} className="text-emerald-100/75">{line}</p>
                            ))}
                        </div>
                    </div>
                    <div>
                        <p className="text-emerald-500">{c.scopeTitle}</p>
                        <div className="mt-2 space-y-1.5 rounded-md border border-amber-900/60 bg-black/50 p-4">
                            {c.scope.map((line) => (
                                <p key={line} className="text-amber-200/80">{line}</p>
                            ))}
                        </div>
                    </div>
                </section>

                {/* CTA */}
                <section className="mt-14 flex flex-wrap items-center gap-4">
                    <button
                        type="button"
                        onClick={() => navigate('/login')}
                        className="border border-emerald-500 bg-emerald-500/10 px-5 py-2 font-bold text-emerald-300 transition hover:bg-emerald-500/25"
                    >
                        $ {c.cta} →
                    </button>
                    <button type="button" onClick={() => navigate('/')} className="text-emerald-700 transition hover:text-emerald-400">
                        {c.back}
                    </button>
                </section>
            </main>
        </div>
    );
};

export default LandingTerminal;
