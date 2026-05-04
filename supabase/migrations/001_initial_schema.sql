-- =================================================================================
-- Kathakitab.ai - Initial Schema
-- =================================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================
-- Core Tables
-- ==========================================

-- Books
CREATE TABLE public.books (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    slug VARCHAR(255) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    subtitle VARCHAR(255),
    description TEXT,
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'mvp', 'published')),
    cover_image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Book Sources
CREATE TABLE public.book_sources (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    book_id UUID REFERENCES public.books(id) ON DELETE CASCADE,
    source_type VARCHAR(50) CHECK (source_type IN ('text', 'scripture', 'commentary', 'academic')),
    title VARCHAR(255) NOT NULL,
    url TEXT,
    citation_note TEXT,
    public_domain_status BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Scenes
CREATE TABLE public.scenes (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    book_id UUID REFERENCES public.books(id) ON DELETE CASCADE,
    scene_id VARCHAR(255) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    order_index INTEGER NOT NULL,
    narration TEXT,
    short_summary TEXT,
    visual_description TEXT,
    background_asset_url TEXT,
    previous_scene_id VARCHAR(255),
    next_scene_id VARCHAR(255),
    mode VARCHAR(50) DEFAULT 'story' CHECK (mode IN ('story', 'learn', 'quiz')),
    source_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Hotspots
CREATE TABLE public.hotspots (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    scene_id VARCHAR(255) REFERENCES public.scenes(scene_id) ON DELETE CASCADE,
    label VARCHAR(255) NOT NULL,
    hotspot_type VARCHAR(50) CHECK (hotspot_type IN ('character', 'object', 'place', 'event')),
    target_type VARCHAR(50) CHECK (target_type IN ('character', 'scene', 'info')),
    target_id VARCHAR(255) NOT NULL,
    x NUMERIC(5,2) NOT NULL, -- percentage 0-100
    y NUMERIC(5,2) NOT NULL, -- percentage 0-100
    width NUMERIC(5,2) NOT NULL, -- percentage
    height NUMERIC(5,2) NOT NULL, -- percentage
    tooltip TEXT,
    action VARCHAR(50) CHECK (action IN ('open_character', 'open_scene', 'open_info', 'open_learning')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Characters
CREATE TABLE public.characters (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    book_id UUID REFERENCES public.books(id) ON DELETE CASCADE,
    slug VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(255),
    short_summary TEXT,
    traits JSONB,
    relationships JSONB,
    character_bible JSONB,
    source_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Character Assets
CREATE TABLE public.character_assets (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    character_id UUID REFERENCES public.characters(id) ON DELETE CASCADE,
    asset_type VARCHAR(50) CHECK (asset_type IN ('portrait', 'full_body', 'icon', 'scene_variant')),
    asset_url TEXT NOT NULL,
    visual_prompt TEXT,
    is_master_reference BOOLEAN DEFAULT false,
    generation_model VARCHAR(100),
    consistency_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Scene Assets
CREATE TABLE public.scene_assets (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    scene_id VARCHAR(255) REFERENCES public.scenes(scene_id) ON DELETE CASCADE,
    asset_type VARCHAR(50) CHECK (asset_type IN ('background', 'overlay', 'illustration')),
    asset_url TEXT NOT NULL,
    visual_prompt TEXT,
    generation_model VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Source References
CREATE TABLE public.source_references (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    book_id UUID REFERENCES public.books(id) ON DELETE CASCADE,
    scene_id VARCHAR(255) REFERENCES public.scenes(scene_id) ON DELETE SET NULL,
    character_id UUID REFERENCES public.characters(id) ON DELETE SET NULL,
    reference_title VARCHAR(255) NOT NULL,
    reference_url TEXT,
    reference_note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Generated Responses (Cache for AI answers)
CREATE TABLE public.generated_responses (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    book_id UUID REFERENCES public.books(id) ON DELETE CASCADE,
    scene_id VARCHAR(255) REFERENCES public.scenes(scene_id) ON DELETE SET NULL,
    character_id UUID REFERENCES public.characters(id) ON DELETE SET NULL,
    user_question TEXT NOT NULL,
    ai_answer TEXT NOT NULL,
    answer_label VARCHAR(50) CHECK (answer_label IN ('CANON', 'EXPLANATION', 'INTERPRETATION', 'CREATIVE')),
    source_note TEXT,
    model_used VARCHAR(100),
    cached_key TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Quizzes
CREATE TABLE public.quizzes (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    scene_id VARCHAR(255) REFERENCES public.scenes(scene_id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    options JSONB NOT NULL,
    correct_answer INTEGER NOT NULL,
    explanation TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- User Progress (For later authentication integration)
CREATE TABLE public.user_progress (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    user_id UUID, -- NULL for anonymous/MVP
    book_id UUID REFERENCES public.books(id) ON DELETE CASCADE,
    current_scene_id VARCHAR(255),
    completed_scenes JSONB DEFAULT '[]'::jsonb,
    quiz_scores JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- ==========================================
-- Indexes
-- ==========================================

CREATE INDEX idx_scenes_book_id ON public.scenes(book_id);
CREATE INDEX idx_scenes_order ON public.scenes(order_index);
CREATE INDEX idx_hotspots_scene_id ON public.hotspots(scene_id);
CREATE INDEX idx_characters_book_id ON public.characters(book_id);
CREATE INDEX idx_generated_responses_cache_key ON public.generated_responses(cached_key);
CREATE INDEX idx_quizzes_scene_id ON public.quizzes(scene_id);

-- ==========================================
-- Triggers for updated_at
-- ==========================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_books_updated_at
BEFORE UPDATE ON public.books
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_scenes_updated_at
BEFORE UPDATE ON public.scenes
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_characters_updated_at
BEFORE UPDATE ON public.characters
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_user_progress_updated_at
BEFORE UPDATE ON public.user_progress
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
