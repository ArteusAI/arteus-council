docker compose -f docker-compose.leads.yml down
docker compose -f docker-compose.leads.yml build --no-cache
docker compose -f docker-compose.leads.yml up -d
