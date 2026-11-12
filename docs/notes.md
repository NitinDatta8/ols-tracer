2. run_show still asks for permission everytime
3. What is stopping us from getting alarms and live state every 500ms? bad architecture? Python? move to C++?
4. How do we fill knowledge.json to understand internals of commands. For example we have OCH different types of values like chromatic dispersion, state of polarization. what do these values mean? How to read them for debug purposes and teaching purposes? Input to agent. whats the best format? any agent can use this. for example there are multiple values that can be set for media channel? what does each option mean? Maybe we make it like a tree start with show hit tab and find all possible options. then keep drilling down recursively and for all possible options we get a proper description.  
5. Command hallucinations are happening. We need to avoid that. If there are multiple candidates you think are possible then ask which one is meant and wait for the answer. 
6.  No need to Open and new and save. We have a fixed set we will just use that on the main page. Update it. Have 3 racks and once I set it up manually we can lock it. To unlock and add new stuff at the chassis level password is Changeit@123. Should be able to freely add linecards and pluggables. 
7. Possible speed-up, not done: the MCP rebuilds a recorded run from scratch on every tool call. Caching runs would cut CPU and memory when six people use it at once.
8.  Software upgrade button at chassis level. Similarly we need to find other workflows that can be translated to UI and button clicks. How? 
9.  
10. 
11. 
12. LATER - Use agent to run the daily sanity and nightly regressions. If test fails auto create JIRA ticket (JIRA MCP). 
13. LATER - Move to netconf over CLI. 