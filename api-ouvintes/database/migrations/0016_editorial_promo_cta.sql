ALTER TABLE editorial_revision
  ADD COLUMN promo_cta_text varchar(100) NOT NULL DEFAULT 'Anuncie sua marca na Rádio 88 FM',
  ADD COLUMN promo_cta_url varchar(500) NOT NULL DEFAULT '/anuncie';

ALTER TABLE editorial_revision
  ADD CONSTRAINT editorial_revision_promo_cta_url_check CHECK (
    promo_cta_url = ''
    OR (promo_cta_url LIKE '/%' AND promo_cta_url NOT LIKE '//%')
    OR promo_cta_url ~* '^https?://'
  );
