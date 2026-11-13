# Notes: done

> **Archived 2026-11-11:** the done items from [notes](../notes.md), as written, under their numbers there.

- **0.** add a new BERT Tester in CSP along with 8 slot chassis. BERT should be able to take in 2 ports with 100G tx-rx then we connect that to the client port. also improve the UI on main level.
- **1.** Add ton more test cases both for OLS MCP and OLS tracer. test for correctness first then test for supporting multiple people and multiple IPs without breaking and consuming less resources. it should support 6 people easily.
- **4.** run show commands ask permission for every command. If we give allow once all run show should run and come back without user permission. Also the flows have to be captured
- **5.** bridge disconnect in 1 codex session for box3 dropped the bridge connection for box1 (paho-gs2000-test01) also which is not what we want.
- **6.** No need to Open and new and save. We have a fixed set we will just use that on the main page. Update it. Have 3 racks and once I set it up manually we can lock it. To unlock and add new stuff at the chassis level password is (kept only as its SHA-256 in `catalog/csp/lab.olst.json`). Should be able to freely add linecards and pluggables.
- **17.** For wiring use show och, show internal-connection, show external-connection, show assignment, show logical-channel, show cross-connection, show media-channel, show optical-port
- **18.** have a terminal click directly at linecards to go to telnet or engineering mode directly.  on main UI page create a rack and put boxes in there. Chassis view what we show show the same there. Additionally when we right click and say open terminal we get a terminal. If we are doing on rack chassis we get normal terminal in show mode. if we are doing on box level in a line card we can directly ask telnet or engineering mode. For some linecards telnet is not possible in those cases when we right click telnet must be greyed out.
- **19.** Speed up the live sync? Run commands in parallel with 2/4/6/8 workers? start with 4 first and minimize time to get live state.
