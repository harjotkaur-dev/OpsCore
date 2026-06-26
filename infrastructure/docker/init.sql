-- Create test database alongside dev database
SELECT 'CREATE DATABASE opscore_test OWNER opscore'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'opscore_test')\gexec
