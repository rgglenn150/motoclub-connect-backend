.PHONY: redeploy pull build stop start restart logs clean

# Default target
redeploy: pull build restart
	@echo "Deployment complete!"

# Pull latest changes from master branch
pull:
	@echo "Pulling latest changes from master branch..."
	git fetch origin
	git checkout master
	git pull origin master

# Build Docker image
build:
	@echo "Building Docker image..."
	docker build -t moto-backend .

# Stop the container
stop:
	@echo "Stopping moto-backend container..."
	-docker stop moto-backend
	@echo "Container stopped."

# Remove the container
clean: stop
	@echo "Removing moto-backend container..."
	-docker rm moto-backend
	@echo "Container removed."

# Start the container
start:
	@echo "Starting moto-backend container..."
	docker run -d \
		--name moto-backend \
		-p 127.0.0.1:3001:4201 \
		--env-file .env \
		--restart unless-stopped \
		moto-backend
	@echo "Container started."

# Restart the container (stop, remove, and start)
restart: stop
	@echo "Removing old container..."
	-docker rm moto-backend
	@$(MAKE) start

# View container logs
logs:
	docker logs -f moto-backend

# View last 50 lines of logs
logs-tail:
	docker logs --tail 50 moto-backend

# Check container status
status:
	@echo "Container status:"
	@docker ps --filter name=moto-backend --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
