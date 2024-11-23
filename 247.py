import os
import random
import time
import subprocess

# List of npm package names to manage
npm_packages = ['pm2', 'express', 'ioredis', 'socket.io', 'ws']

def run_command(command):
    """Run a shell command and return the output."""
    print(f"Running command: {command}")
    result = subprocess.run(command, shell=True, capture_output=True, text=True)
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print(result.stderr)

def install_npm_package(package):
    """Install an npm package globally."""
    print(f"Installing {package}...")
    run_command(f"npm install -g {package}")

def list_npm_packages():
    """List globally installed npm packages."""
    print("Listing globally installed npm packages...")
    run_command("npm list -g --depth=0")

def random_sleep():
    """Sleep for a random amount of time."""
    sleep_time = random.randint(1, 10)
    print(f"Sleeping for {sleep_time} seconds...")
    time.sleep(sleep_time)

def main():
    while True:
        action = random.choice(['install', 'list'])
        
        if action == 'install':
            package = random.choice(npm_packages)
            install_npm_package(package)
        
        elif action == 'list':
            list_npm_packages()
        
        # Random sleep to simulate user activity
        random_sleep()

if __name__ == "__main__":
    main()
