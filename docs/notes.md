
0. anatomy on wss internals same way as in ols pdf. we will run this with our lab setup. ui should show thhat. how??

1. read dbi commands they give you direct info from database. ability to run read only db commands. 
2. LED status and other details display
3. Live status update. When uploaded on server run in round robin every 2 hours to always keep live status. maybe a card was moved from one slot to another or a fiber was plugged out etc etc. 
4. Attach sim and visualize it? we use mk sim csp, mk load csp, mk target csp. Difference between these 3 and how they can be visualized? 
5. Increase the number of procedures. What can we do on the CU level? 
6. MOVE TO NETCONF OVER CLI ASAP
7. What is stopping us from getting alarms and live state every 500ms? bad architecture? Python? move to C++?
8. How do we fill knowledge.json to understand internals of commands. For example we have OCH different types of values like chromatic dispersion, state of polarization. what do these values mean? How to read them for debug purposes and teaching purposes? Input to agent. whats the best format? any agent can use this. for example there are multiple values that can be set for media channel? what does each option mean? Maybe we make it like a tree start with show hit tab and find all possible options. then keep drilling down recursively and for all possible options we get a proper description.  
9.  Command hallucinations are happening. We need to avoid that. If there are multiple candidates you think are possible then ask which one is meant and wait for the answer. 
10. Possible speed-up, not done: the MCP rebuilds a recorded run from scratch on every tool call. Caching runs would cut CPU and memory when six people use it at once.
12. Software upgrade button at chassis level. Similarly we need to find other workflows that can be translated to UI and button clicks. How? 
13. 
14. 
15. 
16. LATER - Use agent to run the daily sanity and nightly regressions. If test fails auto create JIRA ticket (JIRA MCP). 

High-Value Gaps

- NETCONF/DB model map: profiles already carry YANG path keys, DB bindings, and read/write flags (cbtype, classparam, classname) in linecard + port modules, e.g. /home/nmovva/Code/IIVI_Platform/profile/cu/platform/csp/800MX.json:14, /home/nmovva/Code/IIVI_Platform/profile/cu/platform/csp/800MX.json:130, /home/nmovva/Code/IIVI_Platform/profile/cu/platform/csp/800MX.json:197; current sync drops that and keeps only ports/l0/pluggables (scripts/sync-linecards-from-iivi.mjs:1022).
- [DONE] Platform optical/OpenConfig dictionaries: openconfig-rpc, dupparams, OPTICALCHANNEL, widevalidation exist in platform profiles (e.g. /home/nmovva/Code/IIVI_Platform/profile/cu/platform/csp/PLATFORM.json:1050, /home/nmovva/Code/IIVI_Platform/profile/cu/platform/csp/PLATFORM.json:1055, /home/nmovva/Code/IIVI_Platform/profile/cu/platform/csm/PLATFORM.json:935, /home/nmovva/Code/IIVI_Platform/profile/cu/platform/csm/PLATFORM.json:485) but are not emitted by platform sync (scripts/sync-streams-chassis-from-iivi.mjs:308).
- [DONE] L0 parser misses useful variants: parser only targets certain l0 files/tags (scripts/sync-linecards-from-iivi.mjs:396, scripts/sync-linecards-from-iivi.mjs:306, scripts/sync-linecards-from-iivi.mjs:333), while WS has validation_WSS schema (/home/nmovva/Code/IIVI_Platform/profile/cu/l0/ws/l0_validation_profile.xml:2) and Tencent has pluggable amplifier defaults/specs (/home/nmovva/Code/IIVI_Platform/profile/cu/l0/tencent/l0_plug_module_profile.xml:6).
-[DONE] LED behavior is richer than today’s UI model: beyond PLATFORM.LED, l0 has explicit LED command/state mapping (/home/nmovva/Code/IIVI_Platform/profile/cu/l0/csp/l0_cmd_profile.json:2, /home/nmovva/Code/IIVI_Platform/profile/cu/l0/csp/l0_cmd_profile.json:196).