export type Series = {
    id: number;
    title: string;
    title_pinyin: string;
    author: string;
    cover_path: string | null;
    status: string;
    is_favorite: number;
    created_at: string;
    chapter_count: number;
    first_chapter_id?: number;
    last_read_chapter_id?: number | null;
};

export type Chapter = {
    id: number;
    series_id: number;
    title: string;
    chapter_number: number;
    file_path: string;
    format: string;
    page_count: number;
    last_read_page: number;
    is_read: number;
    created_at: string;
};

export type ChapterImage = {
    name: string;
    path: string;
    index: number;
};

// ⭐ 标签
export type Tag = {
    id: number;
    name: string;
    color: string;
    series_count?: number;
};

export type RecentItem = {
    series_id: number;
    series_title: string;
    chapter_id: number;
    chapter_title: string;
    last_read_page: number;
    page_count: number;
    file_path: string;
    format: string;
    chapter_created: string;
};

export type ThemeName = 'dark' | 'black' | 'light' | 'green' | 'purple';

export type AppSettings = {
    theme: ThemeName;
    coverMode: 'dynamic' | 'static';
};

// 页面路由栈（每个元素代表一层）
export type Route =
    | { name: 'home' }
    | { name: 'library' }
    | { name: 'favorites' }
    | { name: 'settings' }
    | { name: 'seriesDetail'; seriesId: number; seriesTitle: string }
    | { name: 'imageWall'; chapterId: number; chapterTitle: string; seriesId: number; seriesTitle: string; isSingleChapter: boolean }
    | { name: 'reader'; chapterId: number; chapterTitle: string; seriesId: number; seriesTitle: string; startPage: number };
// ⭐ 阅读器设置
export type ReaderMode = 'page' | 'scroll';
export type ReaderDirection = 'ltr' | 'rtl';
export type ReaderFit = 'window' | 'width' | 'height' | 'original';

export type ReaderSettings = {
    mode: ReaderMode;
    direction: ReaderDirection;
    fit: ReaderFit;
    fullscreen: boolean;
};
