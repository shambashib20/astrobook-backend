-- Migration: Add sticker columns to posts table
-- IMAGE posts pe draggable text sticker support ke liye
-- stickerX / stickerY: 0.0–1.0 fractional position (percentage / 100)

ALTER TABLE "posts"
  ADD COLUMN IF NOT EXISTS "sticker_text"        text,
  ADD COLUMN IF NOT EXISTS "sticker_x"           numeric(5, 4),
  ADD COLUMN IF NOT EXISTS "sticker_y"           numeric(5, 4),
  ADD COLUMN IF NOT EXISTS "sticker_text_color"  text,
  ADD COLUMN IF NOT EXISTS "sticker_bg_color"    text;
