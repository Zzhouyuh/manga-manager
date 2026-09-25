const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const { app } = require('electron');

let db;

function initDB() {
    const dbPath = path.join(app.getPath('userData'), 'manga.db');
    console.log('数据库位置:', dbPath);
    db = new DatabaseSync(dbPath);

    // 打开外键约束
    db.exec('PRAGMA foreign_keys = ON');

    db.exec(`
    CREATE TABLE IF NOT EXISTS series (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      title_pinyin TEXT DEFAULT '',
      author TEXT DEFAULT '',
      cover_path TEXT,
      status TEXT DEFAULT 'unread',
      is_favorite INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chapters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      series_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      chapter_number REAL DEFAULT 0,
      file_path TEXT UNIQUE,
      format TEXT,
      page_count INTEGER DEFAULT 0,
      last_read_page INTEGER DEFAULT 0,
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE
    );

    -- ⭐ 新增：收藏单页
    CREATE TABLE IF NOT EXISTS favorite_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chapter_id INTEGER NOT NULL,
      page_index INTEGER NOT NULL,
      image_path TEXT NOT NULL,
      note TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
      UNIQUE(chapter_id, page_index)
    );

    -- ⭐ 新增：标签
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      color TEXT DEFAULT '#3b82f6'
    );

    -- 漫画标签关联
    CREATE TABLE IF NOT EXISTS series_tags (
      series_id INTEGER,
      tag_id INTEGER,
      PRIMARY KEY (series_id, tag_id),
      FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );

    -- 收藏页标签关联
    CREATE TABLE IF NOT EXISTS favorite_page_tags (
      page_id INTEGER,
      tag_id INTEGER,
      PRIMARY KEY (page_id, tag_id),
      FOREIGN KEY (page_id) REFERENCES favorite_pages(id) ON DELETE CASCADE,
      FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
    );
  `);

    // 兼容旧数据库：如果 series 表没有 is_favorite 列，加一下
    try {
        db.exec('ALTER TABLE series ADD COLUMN is_favorite INTEGER DEFAULT 0');
    } catch (e) {
        // 列已存在，忽略
    }
}

function getDB() {
    return db;
}

module.exports = { initDB, getDB };