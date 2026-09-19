-- Presence needs display names (roadmap 1.2). Append-only fix to 006.
ALTER TABLE presence ADD COLUMN username TEXT NOT NULL DEFAULT '';
