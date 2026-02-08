
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Lock, ArrowRight, ArrowLeft, CheckCircle, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Logo from '../components/Logo';

const Login = () => {
    const navigate = useNavigate();
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

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || '登录失败');
            }

            // SECURITY FIX: Token now stored in httpOnly cookie by server
            // Only store non-sensitive user info in localStorage
            localStorage.setItem('user', JSON.stringify(data.user));

            setToast({ msg: '登录成功！正在跳转...', type: 'success' });

            setTimeout(() => {
                navigate('/dashboard');
            }, 800);

        } catch (error: any) {
            setToast({ msg: error.message || '登录失败，请检查网络', type: 'info' });
            // Should be type: 'error' visually but using 'info' style for now as per existing component
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
        <div className="bg-[#050505] min-h-screen grid-bg flex items-center justify-center p-4 text-[#e5e5e5] font-sans">
            {/* Toast */}
            <AnimatePresence>
                {toast && (
                    <motion.div
                        initial={{ opacity: 0, x: 100 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 100 }}
                        className={`fixed bottom-5 right-5 z-50 px-6 py-3 rounded-lg backdrop-blur-md border border-white/10 shadow-xl flex items-center gap-3 ${toast.type === 'success' ? 'bg-black/90 border-l-4 border-l-green-500' : 'bg-black/90 border-l-4 border-l-blue-500'}`}
                    >
                        {toast.type === 'success' ? <CheckCircle className="w-5 h-5 text-green-400" /> : <Info className="w-5 h-5 text-blue-400" />}
                        <span className="text-white text-sm font-medium">{toast.msg}</span>
                    </motion.div>
                )}
            </AnimatePresence>

            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-full max-w-md bg-[#111] border border-gray-800 rounded-2xl shadow-2xl p-8 relative overflow-hidden"
            >
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-green-500 to-blue-500"></div>

                <div className="text-center mb-8">
                    <div className="inline-flex items-center gap-2 mb-4">
                        <Logo />
                    </div>
                    <h2 className="text-2xl font-bold text-white">控制台登录</h2>
                    <p className="text-gray-500 text-sm mt-2">请输入您的企业账户凭证</p>
                </div>

                <form onSubmit={handleLogin} className="space-y-6">
                    <div>
                        <label className="block text-xs font-mono text-gray-400 mb-1">EMAIL / USERNAME</label>
                        <div className="relative">
                            <User className="absolute left-3 top-3 w-5 h-5 text-gray-500" />
                            <input
                                type="text"
                                name="email"
                                className="w-full bg-black border border-gray-700 rounded-lg py-2.5 pl-10 pr-4 text-white focus:outline-none focus:border-green-500 transition-colors font-mono text-sm"
                                placeholder="name@company.com"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-mono text-gray-400 mb-1">PASSWORD</label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-3 w-5 h-5 text-gray-500" />
                            <input
                                type="password"
                                name="password"
                                className="w-full bg-black border border-gray-700 rounded-lg py-2.5 pl-10 pr-4 text-white focus:outline-none focus:border-green-500 transition-colors font-mono text-sm"
                                placeholder="••••••••"
                            />
                        </div>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                        <label className="flex items-center text-gray-400 hover:text-white cursor-pointer">
                            <input type="checkbox" className="mr-2 rounded bg-gray-800 border-gray-700 text-green-500 focus:ring-0" /> 记住设备
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
                    <button onClick={() => navigate('/')} className="text-xs text-gray-500 hover:text-white transition-colors flex items-center justify-center gap-1 mx-auto">
                        <ArrowLeft className="w-3 h-3" /> 返回首页
                    </button>
                </div>
            </motion.div>
        </div>
    );
};

export default Login;
