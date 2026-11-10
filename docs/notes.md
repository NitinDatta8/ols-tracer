0.[DONE] add a new BERT Tester in CSP along with 8 slot chassis. BERT should be able to take in 2 ports with 100G tx-rx then we connect that to the client port. also improve the UI on main level. 
1. Add ton more test cases both for OLS MCP and OLS tracer. test for correctness first then test for supporting multiple people and multiple IPs without breaking and consuming less resources. it should support 6 people easily. 
2. What is stopping us from getting alarms and live state every 500ms? bad architecture? Python? move to C++?
3. How do we fill knowledge.json to understand internals of commands. For example we have OCH different types of values like chromatic dispersion, state of polarization. what do these values mean? How to read them for debug purposes and teaching purposes? Input to agent. whats the best format? any agent can use this. for example there are multiple values that can be set for media channel? what does each option mean? Maybe we make it like a tree start with show hit tab and find all possible options. then keep drilling down recursively and for all possible options we get a proper description.  
4. run show commands ask permission for every command. If we give allow once all run show should run and come back without user permission. Also the flows have to be captured
5. bridge disconnect in 1 codex session for box3 dropped the bridge connection for box1 (paho-gs2000-test01) also which is not what we want. 
6. Command hallucinations are happening. We need to avoid that. If there are multiple candidates you think are possible then ask the user as a question and get their response. 
7.  No need to Open and new and save. We have a fixed set we will just use that on the main page. Update it. Have 3 racks and once I set it up manually we can lock it. To unlock and add new stuff at the chassis level password is Changeit@123. Should be able to freely add linecards and pluggables. 
11. Software upgrade button at chassis level. Similarly we need to find other workflows that can be translated to UI and button clicks. How? 
12. 
13. 
14. 
15. LATER - Use agent to run the daily sanity and nightly regressions. If test fails auto create JIRA ticket (JIRA MCP). 
16. LATER - Move to netconf over CLI. 
17. [DONE] For wiring use show och, show internal-connection, show external-connection, show assignment, show logical-channel, show cross-connection, show media-channel, show optical-port
18. [DONE] have a terminal click directly at linecards to go to telnet or engineering mode directly.  on main UI page create a rack and put boxes in there. Chassis view what we show show the same there. Additionally when we right click and say open terminal we get a terminal. If we are doing on rack chassis we get normal terminal in show mode. if we are doing on box level in a line card we can directly ask telnet or engineering mode. For some linecards telnet is not possible in those cases when we right click telnet must be greyed out. 
19. [DONE] Speed up the live sync? Run commands in parallel with 2/4/6/8 workers? start with 4 first and minimize time to get live state. 