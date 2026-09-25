import type { ThemeName } from './types';

export type ThemeColors = {
    name: string;
    bg: string;           // 主背景
    bgSecondary: string;  // 侧边栏背景
    card: string;         // 卡片背景
    cardHover: string;    // 卡片悬停
    text: string;         // 主文字
    textSecondary: string;// 次要文字
    border: string;       // 边框
    primary: string;      // 主色（按钮、强调）
    primaryHover: string;
    progressBg: string;   // 进度条背景
    progressFill: string; // 进度条填充
};

export const themes: Record<ThemeName, ThemeColors> = {
    dark: {
        name: '暗夜黑',
        bg: '#1a1a1a',
        bgSecondary: '#141414',
        card: '#252525',
        cardHover: '#2f2f2f',
        text: '#e8e8e8',
        textSecondary: '#888',
        border: '#333',
        primary: '#3b82f6',
        primaryHover: '#2563eb',
        progressBg: '#333',
        progressFill: '#3b82f6',
    },
    black: {
        name: '纯黑（OLED）',
        bg: '#000000',
        bgSecondary: '#000000',
        card: '#0f0f0f',
        cardHover: '#1a1a1a',
        text: '#e8e8e8',
        textSecondary: '#777',
        border: '#222',
        primary: '#3b82f6',
        primaryHover: '#2563eb',
        progressBg: '#222',
        progressFill: '#3b82f6',
    },
    light: {
        name: '浅色',
        bg: '#f5f5f7',
        bgSecondary: '#ffffff',
        card: '#ffffff',
        cardHover: '#f0f0f2',
        text: '#1a1a1a',
        textSecondary: '#666',
        border: '#e0e0e0',
        primary: '#2563eb',
        primaryHover: '#1d4ed8',
        progressBg: '#e0e0e0',
        progressFill: '#2563eb',
    },
    green: {
        name: '护眼绿',
        bg: '#c7edcc',
        bgSecondary: '#d4f0d9',
        card: '#e8f7ea',
        cardHover: '#d9f2dd',
        text: '#1a3d20',
        textSecondary: '#4a6b50',
        border: '#a8d4ae',
        primary: '#2d7a3e',
        primaryHover: '#245f31',
        progressBg: '#a8d4ae',
        progressFill: '#2d7a3e',
    },
    purple: {
        name: '暗紫',
        bg: '#1a1428',
        bgSecondary: '#120e1f',
        card: '#251d3a',
        cardHover: '#2f2549',
        text: '#e8e3f5',
        textSecondary: '#9b8fc0',
        border: '#3a2f5a',
        primary: '#8b5cf6',
        primaryHover: '#7c3aed',
        progressBg: '#3a2f5a',
        progressFill: '#8b5cf6',
    },
};

export function applyTheme(themeName: ThemeName) {
    const t = themes[themeName];
    const root = document.documentElement;
    root.setAttribute('data-theme', themeName);
    root.style.setProperty('--bg', t.bg);
    root.style.setProperty('--bg-secondary', t.bgSecondary);
    root.style.setProperty('--card', t.card);
    root.style.setProperty('--card-hover', t.cardHover);
    root.style.setProperty('--text', t.text);
    root.style.setProperty('--text-secondary', t.textSecondary);
    root.style.setProperty('--border', t.border);
    root.style.setProperty('--primary', t.primary);
    root.style.setProperty('--primary-hover', t.primaryHover);
    root.style.setProperty('--progress-bg', t.progressBg);
    root.style.setProperty('--progress-fill', t.progressFill);
    document.body.style.background = t.bg;
    document.body.style.color = t.text;
}