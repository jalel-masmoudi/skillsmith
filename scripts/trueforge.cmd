@echo off
set OUTBOUND_URL_ALLOWED_HOSTS=["127.0.0.1","localhost"]
npx @truefoundry/trueforge@latest %*
