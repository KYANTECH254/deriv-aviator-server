#!/bin/bash

# Update and install dependencies
sudo apt update
sudo apt install -y postgresql redis

# Start PostgreSQL service
sudo service postgresql start

# Configure PostgreSQL (optional: customize as needed)
sudo -u postgres psql -c "CREATE USER kyan WITH PASSWORD 'Sss333123kyan';"
sudo -u postgres psql -c "CREATE DATABASE deriv_aviator OWNER kyan;"

# Start Redis service
sudo service redis-server start

# Print services status
echo "PostgreSQL and Redis have been installed and started."
sudo service postgresql status
sudo service redis-server status
