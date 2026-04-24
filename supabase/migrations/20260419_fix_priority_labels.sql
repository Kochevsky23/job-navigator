-- Normalize priority labels to HIGH/MEDIUM/LOW/REJECTED
UPDATE jobs SET priority = 'HIGH'     WHERE priority = 'TOP MATCH';
UPDATE jobs SET priority = 'MEDIUM'   WHERE priority = 'GOOD FIT';
UPDATE jobs SET priority = 'LOW'      WHERE priority = 'MAYBE';
