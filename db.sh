#!/bin/bash
/home/cloudide/.nix-profile/bin/pg_ctl -D ~/pgdata \
-o "-c unix_socket_directories='/home/cloudide/postgresql-run'" \
-l logfile start
