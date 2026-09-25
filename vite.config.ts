import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    server: { port: 5173 },
    base: './',        // ⭐ 关键！打包后资源路径变成相对路径
});