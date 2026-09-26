import type { Chapter, ChapterImage, RecentItem, Series, Tag } from './types';

// 导入结果（scan-and-import / import-files 的返回值）
export type ImportResult = {
    success: boolean;
    error?: string;
    total: number;
    imported: number;
    updated: number;
    skipped: number;
    failures: { file: string; reason: string }[];
};

// 导入进度推送
export type ImportProgress = {
    phase: 'scan' | 'import' | 'done';
    current: number;
    total: number;
    name: string;
};

export type FavoritePage = {
    id: number;
    chapter_id: number;
    page_index: number;
    image_path: string;
    note: string;
    created_at: string;
    chapter_title: string;
    format: string;
    series_id: number;
    series_title: string;
};

export type MangaApi = {
    // 导入
    pickDirectory: () => Promise<string | null>;
    scanAndImport: (dirPath: string) => Promise<ImportResult>;
    pickFiles: () => Promise<string[]>;
    importFiles: (filePaths: string[]) => Promise<ImportResult>;
    // 导入进度推送（返回取消订阅函数）
    onImportProgress: (cb: (p: ImportProgress) => void) => () => void;
    // 漫画库
    listSeries: () => Promise<Series[]>;
    searchSeries: (keyword: string, tagId?: number | null) => Promise<Series[]>;
    listChapters: (seriesId: number) => Promise<Chapter[]>;
    deleteSeries: (seriesId: number) => Promise<{ success: boolean; error?: string }>;
    deleteChapter: (chapterId: number) => Promise<{ success: boolean; error?: string }>;
    // 阅读
    getSeriesCover: (seriesId: number, mode: 'dynamic' | 'static') => Promise<string | null>;
    listChapterImages: (chapterId: number) => Promise<ChapterImage[]>;
    getImage: (imagePath: string) => Promise<string | null>;
    getThumbnail: (imagePath: string, maxWidth?: number) => Promise<string | null>;
    imageUrl: (imagePath: string, maxWidth?: number) => string;
    coverUrl: (seriesId: number, mode?: 'dynamic' | 'static') => string;
    updateProgress: (chapterId: number, page: number) => Promise<{ success: boolean }>;
    recentReading: () => Promise<RecentItem[]>;
    // 收藏
    toggleFavoriteSeries: (seriesId: number) => Promise<{ success: boolean; is_favorite?: number }>;
    listFavoriteSeries: () => Promise<Series[]>;
    favoritePage: (chapterId: number, pageIndex: number, imagePath: string) => Promise<{ success: boolean }>;
    unfavoritePage: (chapterId: number, pageIndex: number) => Promise<{ success: boolean }>;
    isPageFavorited: (chapterId: number, pageIndex: number) => Promise<boolean>;
    listFavoritePages: () => Promise<FavoritePage[]>;
    deleteFavoritePage: (favoriteId: number) => Promise<{ success: boolean }>;
    // 标签
    listTags: () => Promise<Tag[]>;
    createTag: (name: string, color?: string) => Promise<{ success: boolean; tag?: Tag; existed?: boolean; error?: string }>;
    deleteTag: (tagId: number) => Promise<{ success: boolean; error?: string }>;
    getSeriesTags: (seriesId: number) => Promise<Tag[]>;
    setSeriesTags: (seriesId: number, tagIds: number[]) => Promise<{ success: boolean; error?: string }>;
};

declare global {
    interface Window {
        api: MangaApi;
    }
}
