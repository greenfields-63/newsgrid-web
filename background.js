/**
 * NewsGrid Chrome Extension Background Worker
 * Injects required Referer and Origin headers and opens the 2x2 grid in a new full tab.
 */

chrome.action.onClicked.addListener((tab) => {
  chrome.tabs.create({ url: chrome.runtime.getURL("index.html") });
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "get-mako-ticket") {
    const lp = request.lp || "/direct/hls/live/2033791/k12/index.m3u8";
    const dv = request.dv || "1e2258089b67f510VgnVCM2000002a0c10acRCRD";
    const deviceId = "web-" + Math.random().toString(36).substring(2, 12);
    const reqUrl = `https://mass.mako.co.il/ClicksStatistics/entitlementsServicesV2.jsp?et=gt&lp=${encodeURIComponent(lp)}&dv=${dv}&rv=AKAMAI&du=${deviceId}`;

    fetch(reqUrl, { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        const ticket = data.tickets?.[0]?.ticket;
        if (ticket) {
          const finalUrl = `https://mako-streaming.akamaized.net${lp}?${ticket}`;
          sendResponse({ success: true, url: finalUrl });
        } else {
          sendResponse({ success: false, error: "No ticket in response" });
        }
      })
      .catch(err => {
        sendResponse({ success: false, error: err.toString() });
      });
    return true;
  }
});

chrome.declarativeNetRequest.updateDynamicRules({
  removeRuleIds: [1, 2, 3, 4, 5],
  addRules: [
    {
      "id": 1,
      "priority": 1,
      "action": {
        "type": "modifyHeaders",
        "requestHeaders": [
          { "header": "Referer", "operation": "set", "value": "https://www.mako.co.il/" },
          { "header": "Origin", "operation": "set", "value": "https://www.mako.co.il" }
        ],
        "responseHeaders": [
          { "header": "Access-Control-Allow-Origin", "operation": "set", "value": "*" },
          { "header": "Access-Control-Allow-Credentials", "operation": "set", "value": "true" }
        ]
      },
      "condition": {
        "urlFilter": "mako.co.il",
        "resourceTypes": ["xmlhttprequest", "media", "other"]
      }
    },
    {
      "id": 2,
      "priority": 1,
      "action": {
        "type": "modifyHeaders",
        "requestHeaders": [
          { "header": "Referer", "operation": "set", "value": "https://www.mako.co.il/" },
          { "header": "Origin", "operation": "set", "value": "https://www.mako.co.il" }
        ],
        "responseHeaders": [
          { "header": "Access-Control-Allow-Origin", "operation": "set", "value": "*" },
          { "header": "Access-Control-Allow-Credentials", "operation": "set", "value": "true" }
        ]
      },
      "condition": {
        "urlFilter": "akamaized.net",
        "resourceTypes": ["xmlhttprequest", "media", "other"]
      }
    },
    {
      "id": 3,
      "priority": 1,
      "action": {
        "type": "modifyHeaders",
        "requestHeaders": [
          { "header": "Referer", "operation": "set", "value": "https://www.kan.org.il/" },
          { "header": "Origin", "operation": "set", "value": "https://www.kan.org.il" }
        ]
      },
      "condition": {
        "urlFilter": "kan.org.il",
        "resourceTypes": ["xmlhttprequest", "media"]
      }
    },
    {
      "id": 4,
      "priority": 1,
      "action": {
        "type": "modifyHeaders",
        "requestHeaders": [
          { "header": "Referer", "operation": "set", "value": "https://13tv.co.il/" },
          { "header": "Origin", "operation": "set", "value": "https://13tv.co.il" }
        ]
      },
      "condition": {
        "urlFilter": "d18b0e6mopany4.cloudfront.net",
        "resourceTypes": ["xmlhttprequest", "media"]
      }
    },
    {
      "id": 5,
      "priority": 1,
      "action": {
        "type": "modifyHeaders",
        "requestHeaders": [
          { "header": "Referer", "operation": "set", "value": "https://www.cnn.com/" },
          { "header": "Origin", "operation": "set", "value": "https://www.cnn.com" }
        ]
      },
      "condition": {
        "urlFilter": "d3bp6dwmpbdajl.cloudfront.net",
        "resourceTypes": ["xmlhttprequest", "media"]
      }
    }
  ]
}, () => {
  console.log("NewsGrid header injection rules active.");
});
