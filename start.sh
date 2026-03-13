#!/bin/sh
echo "Building THE VOID container..."
docker-compose build

echo "Starting THE VOID..."
docker-compose up -d

echo "The Void is now running on http://localhost:8080"
