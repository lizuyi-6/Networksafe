
import React, { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { useNavigate } from 'react-router-dom';
import { User, Lock, ArrowRight, ArrowLeft, CheckCircle, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Logo from '../components/Logo';

const Login = () => {
    const navigate = useNavigate();
    const { t } = useLanguage();
    const { resolvedTheme } = useTheme();
    const [isLoading, setIsLoading] = useState(false);
    const [toast, setToast] = useState<{ msg: string; type: 'success' | 'info' } | null>(null);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);

        const form = e.target as HTMLFormElement;
        const email = form.email.value;
        const password = form.password.value;

        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include', // SECURITY FIX: Include cookies in request
                body: JSON.stringify({ email, password }),
            });

            let data;
            try {
                data = await response.json();
            } catch (jsonError) {
                throw new Error(response.ok ? '无法解析服务器返回的响应' : `服务器错误 (${response.status}): 请检查后端是否处于运行状态`);
            }

            if (!response.ok) {
                throw new Error(data?.error || '登录失败');
            }

            // SECURITY FIX: Token now stored in httpOnly cookie by server
            // Only store non-sensitive user info in localStorage
            localStorage.setItem('user', JSON.stringify(data.user));

            setToast({ msg: '登录成功！正在跳转...', type: 'success' });

            setTimeout(() => {
                navigate('/dashboard');
            }, 800);

        } catch (error: any) {
            let errorMsg = error.message || '登录失败，请检查网络';
            if (errorMsg.includes('invalid_credentials') || errorMsg.includes('401')) {
                errorMsg = '邮箱或密码错误，请检查后重试';
            }
            setToast({ msg: errorMsg, type: 'info' });
            setTimeout(() => setToast(null), 3000);
        } finally {
            setIsLoading(false);
        }
    };

    const showToast = (msg: string) => {
        setToast({ msg, type: 'info' });
        setTimeout(() => setToast(null), 3000);
    };

    return (
        <div className="h-screen overflow-y-auto overflow-x-hidden grid-bg flex items-center justify-center p-4 font-sans bg-background text-foreground">
            {/* Toast */}
            <AnimatePresence>
                {toast && (
                    <motion.div
                        initial={{ opacity: 0, x: 100 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 100 }}
                        className={`fixed bottom-5 right-5 z-50 px-6 py-3 rounded-lg backdrop-blur-md border shadow-xl flex items-center gap-3 ${toast.type === 'success' ? 'bg-card border-l-4 border-l-green-500' : 'bg-card border-l-4 border-l-blue-500'}`}
                    >
                        {toast.type === 'success' ? <CheckCircle className="w-5 h-5 text-green-400" /> : <Info className="w-5 h-5 text-blue-400" />}
                        <span className="text-foreground text-sm font-medium">{toast.msg}</span>
                    </motion.div>
                )}
            </AnimatePresence>

            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-full max-w-md border rounded-2xl shadow-2xl p-8 relative overflow-hidden bg-card border-border"
            >
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-green-500 to-blue-500"></div>

                <div className="text-center mb-8">
                    <div className="inline-flex items-center gap-2 mb-4">
                        <Logo />
                    </div>
                    <h2 className="text-2xl font-bold text-foreground">控制台登录</h2>
                    <p className="text-sm mt-2 text-muted-foreground">请输入您的企业账户凭证</p>
                </div>

                <form onSubmit={handleLogin} className="space-y-6">
                    <div>
                        <label className="block text-xs font-mono mb-1 text-muted-foreground">EMAIL / USERNAME</label>
                        <div className="relative">
                            <User className="absolute left-3 top-3 w-5 h-5 text-muted-foreground" />
                            <input
                                type="text"
                                name="email"
                                className="w-full rounded-lg py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:border-green-500 transition-colors font-mono bg-background border border-border text-foreground"
                                placeholder="name@company.com"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-mono mb-1 text-muted-foreground">{t('login.password_label')}</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-3 w-5 h-5 text-muted-foreground" />
                            <input
                                type="password"
                                name="password"
                                className="w-full rounded-lg py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:border-green-500 transition-colors font-mono bg-background border border-border text-foreground"
                                placeholder="••••••••"
                            />
                        </div>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                        <label className="flex items-center cursor-pointer text-muted-foreground hover:text-foreground">
                            <input type="checkbox" className="mr-2 rounded text-green-500 focus:ring-0" /> 记住设备
                        </label>
                        <a href="#" onClick={(e) => { e.preventDefault(); showToast('请联系您的管理员重置密码'); }} className="text-green-500 hover:text-green-400">忘记密码?</a>
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading}
                        className={`w-full bg-green-600 hover:bg-green-500 text-white font-bold py-3 rounded-lg shadow-lg shadow-green-900/20 transition-all flex items-center justify-center gap-2 group ${isLoading ? 'opacity-75 cursor-not-allowed' : ''}`}
                    >
                        <span>{isLoading ? '验证中...' : '安全登录'}</span>
                        {!isLoading && <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />}
                    </button>
                </form>

                <div className="mt-6 text-center">
                    <button onClick={() => navigate('/')} className="text-xs flex items-center justify-center gap-1 mx-auto transition-colors text-muted-foreground hover:text-foreground">
                        <ArrowLeft className="w-3 h-3" /> 返回首页
                    </button>
                </div>
            </motion.div>
        </div>
    );
};

export default Login;
