# Task: Verify village markers on the map

## Plan
1. Navigate to http://localhost:3000
2. Search for routes from Saharanpur to Gangoh.
3. Track the route.
4. Verify the map shows villages with dotted lines.
5. Check console logs for villages-related entries.
6. Take screenshot and report findings.

## Status
- [x] Navigate to page (Failed: Connection refused on http://localhost:3000)
- [ ] Search routes (Saharanpur to Gangoh)
- [ ] Track live route
- [ ] Verify map display (amber dots, dotted lines)
- [ ] Check console logs

## Errors Encountered
- Navigating to http://localhost:3000 failed with net::ERR_CONNECTION_REFUSED.
- Navigating to http://127.0.0.1:3000 failed with net::ERR_CONNECTION_REFUSED.
- Navigating to http://localhost:5000 (backend) also failed with net::ERR_CONNECTION_REFUSED.
- It appears the frontend and backend servers are not running or not listening on these ports.