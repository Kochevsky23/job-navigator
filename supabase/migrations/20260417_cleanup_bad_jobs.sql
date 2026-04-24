-- Remove Elbit job where Claude stored "Hebrew Role Name" (couldn't parse Hebrew title)
DELETE FROM jobs
WHERE company = 'Elbit Systems Israel'
  AND role = 'Hebrew Role Name';

-- Remove Fiverr PMO job where location field was corrupted with role text
DELETE FROM jobs
WHERE company = 'Fiverr'
  AND role = 'PMO'
  AND location LIKE '%Business Operations%';
