-- Multiface loggar alla kundens uppladdade porträtt (inte bara det första)
-- så admin-Analytics kan visa samtliga. Äldre rader saknar värdet — UI:t
-- faller tillbaka på input_image_url.
alter table public.generations add column if not exists input_image_urls jsonb;
