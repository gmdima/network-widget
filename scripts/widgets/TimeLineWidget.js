export function createTimeLineWidget(CampaignCodexWidget) {
class TimeLineWidget extends CampaignCodexWidget {
    constructor(widgetId, initialData, document) {
        super(widgetId, initialData, document);
        this.timeline = null;
        this.widgetData = null;
        this.dataset = null;
    }

    async render() {
        return `
            <div class="cc-widget timeline-widget">
                <div id="timeline-${this.widgetId}" class="timeline-container" style="height: 400px; border: 1px solid #ccc;"></div>
                ${
                    this.isGM
                        ? `<div class="widget-controls">
                                <button type="button" class="add-timeline-item"><i class="fas fa-plus"></i> Add Event</button>
                                <button type="button" class="edit-timeline-config"><i class="fas fa-cog"></i> Configure</button>
                                <button type="button" class="clear-timeline"><i class="fas fa-trash"></i> Clear Timeline</button>
                              </div>`
                        : ""
                }
            </div>
        `;
    }

    async activateListeners(htmlElement) {
        super.activateListeners(htmlElement);
        
        // Load widget data
        this.widgetData = (await this.getData()) || { 
            events: [], 
            config: {
                title: "Campaign Timeline",
                showCurrentTime: false,
                orientation: "bottom",
                stack: true,
                zoomable: true,
                moveable: true,
                selectable: true
            }
        };

        const timelineContainer = htmlElement.querySelector(`#timeline-${this.widgetId}`);
        if (!timelineContainer) {
            console.error(`Campaign Codex | Timeline container not found for widget ${this.widgetId}`);
            return;
        }

        // Check if vis-timeline is available
        if (typeof window.vis === 'undefined' || !window.vis.Timeline) {
            timelineContainer.innerHTML = `
                <div style="padding: 20px; text-align: center; color: #999;">
                    <p><i class="fas fa-exclamation-triangle"></i> Timeline library not loaded</p>
                    <p>Please ensure vis-timeline library is included in your module.</p>
                </div>
            `;
            return;
        }

        await this._initializeTimeline(timelineContainer);

        // Add GM controls
        if (this.isGM) {
            htmlElement
                .querySelector(".add-timeline-item")
                ?.addEventListener("click", this._onAddTimelineItem.bind(this));
            htmlElement
                .querySelector(".edit-timeline-config")
                ?.addEventListener("click", this._onEditTimelineConfig.bind(this));
            htmlElement
                .querySelector(".clear-timeline")
                ?.addEventListener("click", this._onClearTimeline.bind(this));
        }
    }

    async _initializeTimeline(container) {
        try {
            // Ensure all events have groups (for backward compatibility)
            let dataChanged = false;
            this.widgetData.events.forEach(event => {
                if (!event.group || event.group.trim() === '') {
                    event.group = 'General';
                    dataChanged = true;
                }
            });
            
            // Save data if we've updated events with default groups
            if (dataChanged) {
                await this.saveData(this.widgetData);
            }
            
            // Prepare the data - simplified without calendar conversion
            const items = new window.vis.DataSet(this.widgetData.events.map(event => ({
                id: event.id,
                content: event.title,
                start: new Date(event.start),
                end: event.end ? new Date(event.end) : null,
                type: event.type || 'point',
                group: event.group,
                title: event.description || event.title,
                className: `timeline-event-${event.category || 'default'}`,
                style: event.style || null
            })));

            // Create groups - always create the groups dataset for consistent behavior
            const groups = new window.vis.DataSet();
            const uniqueGroups = [...new Set(this.widgetData.events
                .filter(event => event.group && event.group.trim() !== '')
                .map(event => event.group))];
            
            uniqueGroups.forEach(groupName => {
                groups.add({
                    id: groupName,
                    content: groupName
                });
            });

            // Timeline options - simplified for custom event timeline
            const options = {
                width: '100%',
                height: '100%',
                orientation: this.widgetData.config.orientation || 'bottom',
                stack: this.widgetData.config.stack !== false,
                zoomable: this.widgetData.config.zoomable !== false,
                moveable: true, // Allow dragging timeline view for scrolling
                selectable: this.widgetData.config.selectable !== false && this.isGM,
                showCurrentTime: false,
                editable: {
                    add: false,         // Disable adding via drag
                    updateTime: false,  // Disable dragging items in time
                    updateGroup: false, // Disable dragging items between groups
                    remove: false,      // Disable deleting via keyboard
                    overrideItems: false // Disable item editing via timeline
                },
                verticalScroll: true, // Enable vertical scrolling
                horizontalScroll: true, // Enable horizontal scrolling
                margin: {
                    item: 10,
                    axis: 20
                },
                // Hide time axis labels for clean event timeline
                timeAxis: {
                    scale: 'year',
                    step: 1
                },
                format: {
                    minorLabels: {
                        year: '',
                        month: '',
                        day: ''
                    },
                    majorLabels: {
                        year: '',
                        month: '', 
                        day: ''
                    }
                }
            };

            // Create timeline - always pass groups for consistent behavior
            this.timeline = new window.vis.Timeline(container, items, groups, options);

            // Add event listeners for GM interactions
            if (this.isGM) {
                this.timeline.on('doubleClick', (properties) => {
                    if (properties.item) {
                        this._onEditTimelineItem(properties.item);
                    } else {
                        // Double-click on empty space to add new item
                        this._onAddTimelineItemAtTime(properties.time);
                    }
                });
            }

            // Store reference to the datasets
            this.dataset = items;
            this.groupsDataset = groups;

        } catch (error) {
            console.error(`Campaign Codex | Error initializing timeline widget ${this.widgetId}:`, error);
            container.innerHTML = `
                <div style="padding: 20px; text-align: center; color: #f00;">
                    <p><i class="fas fa-exclamation-triangle"></i> Error initializing timeline</p>
                    <p>${error.message}</p>
                </div>
            `;
        }
    }

    async _onAddTimelineItem(event) {
        event?.preventDefault();
        if (!this.isGM) return;

        const now = new Date();
        await this._editTimelineItemDialog(null, now);
    }

    async _onAddTimelineItemAtTime(time) {
        if (!this.isGM) return;
        await this._editTimelineItemDialog(null, time);
    }

    async _onEditTimelineItem(itemId) {
        if (!this.isGM) return;
        
        const eventData = this.widgetData.events.find(e => e.id === itemId);
        if (eventData) {
            await this._editTimelineItemDialog(eventData);
        }
    }

    async _onTimelineItemSelect(itemId) {
        if (!this.isGM) return;
        
        const eventData = this.widgetData.events.find(e => e.id === itemId);
        if (eventData && eventData.journalUuid) {
            this._onOpenDocument(eventData.journalUuid, "Journal");
        }
    }

    async _editTimelineItemDialog(existingEvent = null, defaultTime = null) {
        const isEditing = existingEvent !== null;
        
        const eventData = existingEvent || {
            title: "",
            description: "",
            start: defaultTime || new Date(),
            end: null,
            type: "point",
            category: "default",
            group: "",
            journalUuid: null
        };

        const categories = [
            { key: "default", label: "Default", color: "#3366cc" },
            { key: "battle", label: "Battle", color: "#dc3912" },
            { key: "discovery", label: "Discovery", color: "#ff9900" },
            { key: "social", label: "Social", color: "#109618" },
            { key: "travel", label: "Travel", color: "#990099" },
            { key: "rest", label: "Rest", color: "#0099c6" },
            { key: "quest", label: "Quest", color: "#dd4477" },
            { key: "milestone", label: "Milestone", color: "#66aa00" }
        ];

        const typeOptions = [
            { key: "point", label: "Point in Time" },
            { key: "range", label: "Time Range" },
            { key: "box", label: "Box (with duration)" }
        ];

        const formatDateTime = (date) => {
            if (!date) return "";
            const d = new Date(date);
            return d.toISOString().slice(0, 16);
        };

        const categoryOptions = categories.map(cat => 
            `<option value="${cat.key}" ${cat.key === eventData.category ? 'selected' : ''}>
                ${cat.label}
            </option>`
        ).join("");

        const typeSelectOptions = typeOptions.map(type => 
            `<option value="${type.key}" ${type.key === eventData.type ? 'selected' : ''}>
                ${type.label}
            </option>`
        ).join("");

        const content = `
            <div class="form-group">
                <label>Event Title:</label>
                <input type="text" name="eventTitle" value="${foundry.utils.escapeHTML(eventData.title)}" autofocus required/>
            </div>
            <div class="form-group">
                <label>Description:</label>
                <textarea name="eventDescription" placeholder="Optional description for the event" style="width: 100%; height: 60px; resize: vertical;">${foundry.utils.escapeHTML(eventData.description || "")}</textarea>
            </div>
            <div class="form-group">
                <label>Start Date/Time:</label>
                <input type="datetime-local" name="startTime" value="${formatDateTime(eventData.start)}" required/>
            </div>
            <div class="form-group">
                <label>Event Type:</label>
                <select name="eventType" id="eventTypeSelect">
                    ${typeSelectOptions}
                </select>
            </div>
            <div class="form-group" id="endTimeGroup" style="${eventData.type === 'point' ? 'display: none;' : ''}">
                <label>End Date/Time:</label>
                <input type="datetime-local" name="endTime" value="${formatDateTime(eventData.end)}"/>
            </div>
            <div class="form-group">
                <label>Category:</label>
                <select name="eventCategory">
                    ${categoryOptions}
                </select>
            </div>
            <div class="form-group">
                <label>Group:</label>
                <input type="text" name="eventGroup" value="${foundry.utils.escapeHTML(eventData.group || "")}" placeholder="e.g., Party Actions, NPC Events" required/>
                <small style="color: #666; margin-top: 2px; display: block;">Groups help organize events on the timeline</small>
            </div>
            <style>
                .form-group { margin-bottom: 12px; }
                .form-group label { display: block; margin-bottom: 4px; font-weight: bold; }
                .form-group input, .form-group select, .form-group textarea { width: 100%; padding: 4px; }
            </style>
        `;

        const result = await new Promise((resolve) => {
            const dialog = new foundry.applications.api.DialogV2({
                window: { title: isEditing ? "Edit Timeline Event" : "Add Timeline Event" },
                content: content,
                rejectClose: false,
                buttons: [{
                    action: "save",
                    label: "Save",
                    default: true,
                    callback: (event, button) => {
                        const formData = new FormData(button.form);
                        const result = {
                            title: formData.get("eventTitle").trim(),
                            description: formData.get("eventDescription").trim(),
                            start: formData.get("startTime"),
                            end: formData.get("endTime") || null,
                            type: formData.get("eventType"),
                            category: formData.get("eventCategory"),
                            group: formData.get("eventGroup").trim() || null
                        };
                        
                        if (!result.title || !result.start) {
                            ui.notifications.error("Title and start time are required.");
                            return resolve(null);
                        }
                        
                        if (!result.group || result.group.trim() === '') {
                            ui.notifications.error("Group is required to organize events on the timeline.");
                            return resolve(null);
                        }
                        
                        resolve(result);
                    }
                }, {
                    action: "cancel",
                    label: "Cancel", 
                    callback: () => resolve(null)
                }].concat(isEditing ? [{
                    action: "delete",
                    label: "Delete",
                    callback: () => resolve({ delete: true })
                }] : [])
            });

            // Set up event type change handler
            dialog.addEventListener("render", () => {
                const typeSelect = dialog.element.querySelector('#eventTypeSelect');
                const endTimeGroup = dialog.element.querySelector('#endTimeGroup');
                
                typeSelect.addEventListener('change', () => {
                    endTimeGroup.style.display = typeSelect.value === 'point' ? 'none' : 'block';
                });
            });

            dialog.render(true);
        });

        if (result === null) return;

        if (result.delete) {
            await this._deleteTimelineEvent(existingEvent.id);
            return;
        }

        if (isEditing) {
            await this._updateTimelineEvent(existingEvent.id, result);
        } else {
            await this._addTimelineEvent(result);
        }
    }

    async _addTimelineEvent(eventData) {
        const newEvent = {
            id: foundry.utils.randomID(),
            ...eventData,
            start: new Date(eventData.start).toISOString(),
            end: eventData.end ? new Date(eventData.end).toISOString() : null
        };

        this.widgetData.events.push(newEvent);
        await this.saveData(this.widgetData);

        // Add to timeline
        if (this.dataset) {
            this.dataset.add({
                id: newEvent.id,
                content: newEvent.title,
                start: new Date(newEvent.start),
                end: newEvent.end ? new Date(newEvent.end) : null,
                type: newEvent.type,
                group: newEvent.group,
                title: newEvent.description || newEvent.title,
                className: `timeline-event-${newEvent.category || 'default'}`
            });

            // If this event has a group, we need to check if the group exists
            if (newEvent.group && newEvent.group.trim() !== '' && this.groupsDataset) {
                const existingGroups = this.groupsDataset.get();
                const groupExists = existingGroups.some(g => g.id === newEvent.group);
                
                if (!groupExists) {
                    this.groupsDataset.add({
                        id: newEvent.group,
                        content: newEvent.group
                    });
                }
            }
        }

        ui.notifications.info(`Added timeline event: ${newEvent.title}`);
    }

    async _updateTimelineEvent(eventId, updates) {
        const eventIndex = this.widgetData.events.findIndex(e => e.id === eventId);
        if (eventIndex === -1) return;

        this.widgetData.events[eventIndex] = {
            ...this.widgetData.events[eventIndex],
            ...updates,
            start: new Date(updates.start).toISOString(),
            end: updates.end ? new Date(updates.end).toISOString() : null
        };

        await this.saveData(this.widgetData);

        // Update timeline
        if (this.dataset) {
            const updatedEvent = this.widgetData.events[eventIndex];
            this.dataset.update({
                id: updatedEvent.id,
                content: updatedEvent.title,
                start: new Date(updatedEvent.start),
                end: updatedEvent.end ? new Date(updatedEvent.end) : null,
                type: updatedEvent.type,
                group: updatedEvent.group,
                title: updatedEvent.description || updatedEvent.title,
                className: `timeline-event-${updatedEvent.category || 'default'}`
            });

            // If this event has a group, we need to check if the group exists
            if (updatedEvent.group && updatedEvent.group.trim() !== '' && this.groupsDataset) {
                const existingGroups = this.groupsDataset.get();
                const groupExists = existingGroups.some(g => g.id === updatedEvent.group);
                
                if (!groupExists) {
                    this.groupsDataset.add({
                        id: updatedEvent.group,
                        content: updatedEvent.group
                    });
                }
            }
        }

        ui.notifications.info(`Updated timeline event: ${updates.title}`);
    }

    async _deleteTimelineEvent(eventId) {
        const confirmed = await this.confirmationDialog("Are you sure you want to delete this timeline event?");
        if (!confirmed) return;

        this.widgetData.events = this.widgetData.events.filter(e => e.id !== eventId);
        await this.saveData(this.widgetData);

        // Remove from timeline
        if (this.dataset) {
            this.dataset.remove(eventId);
        }

        ui.notifications.info("Timeline event deleted.");
    }

    async _onEditTimelineConfig(event) {
        event?.preventDefault();
        if (!this.isGM) return;

        const config = this.widgetData.config || {};

        const content = `
            <div class="form-group">
                <label>Timeline Title:</label>
                <input type="text" name="title" value="${foundry.utils.escapeHTML(config.title || "Campaign Timeline")}"/>
            </div>
            <div class="form-group">
                <label>
                    <input type="checkbox" name="showCurrentTime" ${config.showCurrentTime ? 'checked' : ''}/>
                    Show Current Time Line
                </label>
                <small style="display: block; margin-top: 4px; color: #666;">
                    Shows the current time on the timeline
                </small>
            </div>
            <div class="form-group">
                <label>Orientation:</label>
                <select name="orientation">
                    <option value="bottom" ${config.orientation === 'bottom' ? 'selected' : ''}>Bottom</option>
                    <option value="top" ${config.orientation === 'top' ? 'selected' : ''}>Top</option>
                </select>
            </div>
            <div class="form-group">
                <label>
                    <input type="checkbox" name="stack" ${config.stack !== false ? 'checked' : ''}/>
                    Stack Events
                </label>
            </div>
            <div class="form-group">
                <label>
                    <input type="checkbox" name="zoomable" ${config.zoomable !== false ? 'checked' : ''}/>
                    Zoomable
                </label>
            </div>
            <style>
                .form-group { margin-bottom: 12px; }
                .form-group label { display: block; margin-bottom: 4px; font-weight: bold; }
                .form-group input, .form-group select { padding: 4px; }
            </style>
        `;

        const result = await new Promise((resolve) => {
            const dialog = new foundry.applications.api.DialogV2({
                window: { title: "Configure Timeline" },
                content: content,
                rejectClose: false,
                buttons: [{
                    action: "save",
                    label: "Save",
                    default: true,
                    callback: (event, button) => {
                        const formData = new FormData(button.form);
                        resolve({
                            title: formData.get("title"),
                            showCurrentTime: formData.has("showCurrentTime"),
                            orientation: formData.get("orientation"),
                            stack: formData.has("stack"),
                            zoomable: formData.has("zoomable")
                        });
                    }
                }, {
                    action: "cancel",
                    label: "Cancel",
                    callback: () => resolve(null)
                }]
            });

            dialog.render(true);
        });

        if (result !== null) {
            this.widgetData.config = { ...this.widgetData.config, ...result };
            await this.saveData(this.widgetData);
            
            // Reinitialize timeline with new config
            if (this.timeline) {
                this.timeline.destroy();
            }
            
            const container = document.querySelector(`#timeline-${this.widgetId}`);
            if (container) {
                await this._initializeTimeline(container);
            }
            
            ui.notifications.info("Timeline configuration updated.");
        }
    }

    async _onClearTimeline(event) {
        event?.preventDefault();
        if (!this.isGM) return;

        const confirmed = await this.confirmationDialog("Are you sure you want to clear all timeline events? This cannot be undone.");
        if (!confirmed) return;

        this.widgetData.events = [];
        await this.saveData(this.widgetData);

        // Clear timeline
        if (this.dataset) {
            this.dataset.clear();
        }

        ui.notifications.info("Timeline cleared.");
    }

    /**
     * Clean up resources when the widget is destroyed
     */
    destroy() {
        // Clean up timeline
        if (this.timeline) {
            this.timeline.destroy();
            this.timeline = null;
        }

        // Clean up datasets
        if (this.dataset) {
            this.dataset = null;
        }
        
        if (this.groupsDataset) {
            this.groupsDataset = null;
        }
    }
}
return TimeLineWidget;
}