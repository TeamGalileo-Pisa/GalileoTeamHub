-- 1. Aggiunta campo slug alla tabella areas (se non esistente)
ALTER TABLE areas 
ADD COLUMN IF NOT EXISTS slug TEXT UNIQUE;

-- Generazione automatica dello slug per le aree esistenti senza slug
UPDATE areas 
SET slug = LOWER(REGEXP_REPLACE(name, '[^a-zA-Z0-9]+', '-', 'g')) 
WHERE slug IS NULL;

-- Rendiamo il campo slug obbligatorio
ALTER TABLE areas 
ALTER COLUMN slug SET NOT NULL;

-- Indice per ricerca rapida per slug
CREATE INDEX IF NOT EXISTS idx_areas_slug ON areas(slug);

-- 2. Stored Procedure per recuperare il calendario unico dell'Area
CREATE OR REPLACE FUNCTION get_area_public_calendar(
  p_area_slug TEXT,
  p_start_date DATE DEFAULT CURRENT_DATE,
  p_end_date DATE DEFAULT (CURRENT_DATE + INTERVAL '60 days')
)
RETURNS TABLE (
  slot_id UUID,
  area_id UUID,
  area_name TEXT,
  area_description TEXT,
  session_date DATE,
  start_time TIME,
  end_time TIME,
  max_capacity INT,
  booked_count INT,
  available_capacity INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.id AS slot_id,
    a.id AS area_id,
    a.name AS area_name,
    a.description AS area_description,
    s.session_date,
    s.start_time,
    s.end_time,
    s.max_capacity,
    COALESCE(COUNT(b.id), 0)::INT AS booked_count,
    (s.max_capacity - COALESCE(COUNT(b.id), 0)::INT) AS available_capacity
  FROM areas a
  JOIN sessions s ON s.area_id = a.id
  LEFT JOIN bookings b ON b.session_id = s.id AND b.status = 'confirmed'
  WHERE a.slug = p_area_slug
    AND s.is_active = TRUE
    AND s.session_date BETWEEN p_start_date AND p_end_date
  GROUP BY s.id, a.id, a.name, a.description
  HAVING (s.max_capacity - COALESCE(COUNT(b.id), 0)::INT) > 0
  ORDER BY s.session_date ASC, s.start_time ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;