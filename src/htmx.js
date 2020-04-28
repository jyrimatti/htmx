var HTMx = HTMx || (function () {
        'use strict';

        function parseInterval(str) {
            if (str === "null" || str === "false" || str === "") {
                return null;
            } else if (str.lastIndexOf("ms") === str.length - 2) {
                return parseFloat(str.substr(0, str.length - 2));
            } else if (str.lastIndexOf("s") === str.length - 1) {
                return parseFloat(str.substr(0, str.length - 1)) * 1000;
            } else {
                return 1000;
            }
        }

        // resolve with both hx and data-hx prefixes
        function getAttributeValue(elt, qualifiedName) {
            return elt.getAttribute(qualifiedName) || elt.getAttribute("data-" + qualifiedName);
        }

        function getClosestAttributeValue(elt, attributeName) {
            var attribute = getAttributeValue(elt, attributeName);
            if (attribute) {
                return attribute;
            } else if (elt.parentElement) {
                return getClosestAttributeValue(elt.parentElement, attributeName);
            } else {
                return null;
            }
        }

        function getTarget(elt) {
            var targetVal = getClosestAttributeValue(elt, "hx-target");
            if (targetVal) {
                return document.querySelector(targetVal);
            } else {
                return elt;
            }
        }

        function makeFragment(resp) {
            var range = document.createRange();
            return range.createContextualFragment(resp);
        }

        function processResponseNodes(parent, target, text, after) {
            var fragment = makeFragment(text);
            for (var i = fragment.childNodes.length - 1; i >= 0; i--) {
                var child = fragment.childNodes[i];
                parent.insertBefore(child, target);
                if (child.nodeType !== Node.TEXT_NODE) {
                    processElement(child);
                }
            }
            if(after) {
                after.call();
            }
        }

        function swapResponse(elt, resp, after) {
            var target = getTarget(elt);
            var swapStyle = getClosestAttributeValue(elt, "hx-swap");
            if (swapStyle === "outerHTML") {
                processResponseNodes(target.parentElement, target, resp, after);
                target.parentElement.removeChild(target);
            } else if (swapStyle === "prepend") {
                processResponseNodes(target, target.firstChild, resp, after);
            } else if (swapStyle === "prependBefore") {
                processResponseNodes(target.parentElement, target, resp, after);
            } else if (swapStyle === "append") {
                processResponseNodes(target, null, resp, after);
            } else if (swapStyle === "appendAfter") {
                processResponseNodes(target.parentElement, target.nextSibling, resp, after);
            } else {
                target.innerHTML = "";
                processResponseNodes(target, null, resp, after);
            }
        }

        function triggerEvent(elt, eventName, details) {
            details["elt"] = elt;
            if (window.CustomEvent && typeof window.CustomEvent === 'function') {
                var event = new CustomEvent(eventName, {detail: details});
            } else {
                var event = document.createEvent('CustomEvent');
                event.initCustomEvent(eventName, true, true, details);
            }
            elt.dispatchEvent(event);
        }

        function isRawObject(o) {
            return Object.prototype.toString.call(o) === "[object Object]";
        }

        function handleTrigger(elt, trigger) {
            if (trigger) {
                if (trigger.indexOf("{") === 0) {
                    var triggers = JSON.parse(trigger);
                    for (var eventName in triggers) {
                        if (triggers.hasOwnProperty(eventName)) {
                            var details = triggers[eventName];
                            if (!isRawObject(details)) {
                                details = {"value": details}
                            }
                            triggerEvent(elt, eventName, details);
                        }
                    }
                } else {
                    triggerEvent(elt, trigger, []);
                }
            }
        }

        function makeHistoryId() {
            return Math.random().toString(36).substr(3, 9);
        }

        function getHistoryElement() {
            var historyElt = document.getElementsByClassName('hx-history-element');
            if (historyElt.length > 0) {
                return historyElt[0];
            } else {
                return document.body;
            }
        }

        function saveLocalHistoryData(historyData) {
            localStorage.setItem('hx-history', JSON.stringify(historyData));
        }

        function getLocalHistoryData() {
            var historyEntry = localStorage.getItem('hx-history');
            if (historyEntry) {
                var historyData = JSON.parse(historyEntry);
            } else {
                var initialId = makeHistoryId();
                var historyData = {"current": initialId, "slots": [initialId]};
                saveLocalHistoryData(historyData);
            }
            return historyData;
        }

        function newHistoryData() {
            var historyData = getLocalHistoryData();
            var newId = makeHistoryId();
            var slots = historyData.slots;
            if (slots.length > 20) {
                var toEvict = slots.shift();
                localStorage.removeItem('hx-history-' + toEvict);
            }
            slots.push(newId);
            historyData.current = newId;
            saveLocalHistoryData(historyData);
        }

        function updateCurrentHistoryContent() {
            var elt = getHistoryElement();
            var historyData = getLocalHistoryData();
            history.replaceState({"hx-history-key": historyData.current}, document.title, window.location.href);
            localStorage.setItem('hx-history-' + historyData.current, elt.innerHTML);
        }

        function restoreHistory(data) {
            var historyKey = data['hx-history-key'];
            var content = localStorage.getItem('hx-history-' + historyKey);
            var elt = getHistoryElement();
            elt.innerHTML = "";
            processResponseNodes(elt, null, content);
        }

        function snapshotForCurrentHistoryEntry(elt) {
            if (getClosestAttributeValue(elt, "hx-push-url") === "true") {
                // TODO event to allow deinitialization of HTML elements in target
                updateCurrentHistoryContent();
            }
        }

        function initNewHistoryEntry(elt, url) {
            if (getClosestAttributeValue(elt, "hx-push-url") === "true") {
                newHistoryData();
                history.pushState({}, "", url);
                updateCurrentHistoryContent();
            }
        }

        // core ajax request
        function issueAjaxRequest(elt, url) {
            var request = new XMLHttpRequest();
            // TODO - support more request types POST, PUT, DELETE, etc.
            request.open('GET', url, true);
            request.onload = function () {
                snapshotForCurrentHistoryEntry(elt, url);
                var trigger = this.getResponseHeader("X-HX-Trigger");
                handleTrigger(elt, trigger);
                initNewHistoryEntry(elt, url);
                if (this.status >= 200 && this.status < 400) {
                    // don't process 'No Content' response
                    if (this.status != 204) {
                        // Success!
                        var resp = this.response;
                        swapResponse(elt, resp, function(){
                            updateCurrentHistoryContent();
                        });
                    }
                } else {
                    // TODO error handling
                    elt.innerHTML = "ERROR";
                }
            };
            request.onerror = function () {
                // TODO error handling
                // There was a connection error of some sort
            };
            request.send();
        }

        function matches(el, selector) {
            return (el.matches || el.matchesSelector || el.msMatchesSelector || el.mozMatchesSelector || el.webkitMatchesSelector || el.oMatchesSelector).call(el, selector);
        }


        function getTrigger(elt) {
            var explicitTrigger = getClosestAttributeValue(elt, 'hx-trigger');
            if (explicitTrigger) {
                return explicitTrigger;
            } else {
                if (matches(elt, 'button')) {
                    return 'click';
                } else if (matches(elt, 'form')) {
                    return 'submit';
                } else if (matches(elt, 'input, textarea, select')) {
                    return 'change';
                } else {
                    return 'click';
                }
            }
        }

// DOM element processing
        function processClassList(elt, classList, operation) {
            var values = classList.split(",");
            for (var i = 0; i < values.length; i++) {
                var cssClass = "";
                var delay = 50;
                if (values[i].trim().indexOf(":") > 0) {
                    var split = values[i].trim().split(':');
                    cssClass = split[0];
                    delay = parseInterval(split[1]);
                } else {
                    cssClass = values[i].trim();
                }
                setTimeout(function () {
                    elt.classList[operation].call(elt.classList, cssClass);
                }, delay);
            }
        }

        function processElement(elt) {
            if (getAttributeValue(elt, 'hx-get')) {
                var trigger = getTrigger(elt);
                if (trigger === 'load') {
                    issueAjaxRequest(elt, getAttributeValue(elt, 'hx-get'));
                } else {
                    elt.addEventListener(trigger, function (evt) {
                        issueAjaxRequest(elt, getAttributeValue(elt, 'hx-get'));
                        evt.stopPropagation();
                    });
                }
            }
            if (getAttributeValue(elt, 'hx-add-class')) {
                processClassList(elt, getAttributeValue(elt, 'hx-add-class'), "add");
            }
            if (getAttributeValue(elt, 'hx-remove-class')) {
                processClassList(elt, getAttributeValue(elt, 'hx-remove-class'), "remove");
            }
            for (var i = 0; i < elt.children.length; i++) {
                var child = elt.children[i];
                processElement(child);
            }
        }

        function ready(fn) {
            if (document.readyState !== 'loading') {
                fn();
            } else {
                document.addEventListener('DOMContentLoaded', fn);
            }
        }

        // initialize the document
        ready(function () {
            processElement(document.body);
            window.onpopstate = function (event) {
                restoreHistory(event.state);
            };
        })

        // Public API
        return {
            processElement: processElement,
            version: "0.0.1"
        }
    }

)();