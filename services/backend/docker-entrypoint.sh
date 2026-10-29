#!/bin/sh
set -eu
# Render mounts the persistent disk after the image is built.
mkdir -p /var/data/quiver/renders
chown node:node /var/data/quiver /var/data/quiver/renders
exec gosu node "$@"
