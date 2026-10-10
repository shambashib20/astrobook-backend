-- Migration: category_media table
-- Admin yahan har category ke liye hero video / image URL store karta hai.
-- id = category slug (hardcoded constant se match karta hai).

CREATE TABLE IF NOT EXISTS "category_media" (
  "id"             text PRIMARY KEY,
  "hero_video_url" text,
  "hero_image_url" text,
  "updated_at"     timestamptz NOT NULL DEFAULT now()
);
