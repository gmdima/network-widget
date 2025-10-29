export function createNetworkWidget(CampaignCodexWidget) {

class NetworkWidget extends CampaignCodexWidget {
    constructor(widgetId, initialData, document) {
        super(widgetId, initialData, document);
        this.svg = null;
        this.simulation = null;
        this.nodes = [];
        this.links = [];
        this.nodeElements = null;
        this.linkElements = null;
        this.nodeMap = new Map(); // Store actor UUID to node mapping
        this.linkingMode = false;
        this.selectedNode = null;
        this.widgetData = null;
        this.container = null;
        this.width = 800;
        this.height = 600;
        
        // Add static zoom state storage
        NetworkWidget._zoomStates = NetworkWidget._zoomStates || new Map();

        this.floatingImages = [];
        this.selectedFloatingImageId = null;
        this.isFullscreen = false;
        this.fullscreenOverlay = null;
    }

    // Static method to store zoom state
    static storeZoomState(widgetId, transform) {
        if (!NetworkWidget._zoomStates) {
            NetworkWidget._zoomStates = new Map();
        }
        NetworkWidget._zoomStates.set(widgetId, {
            transform: transform,
            timestamp: Date.now()
        });
    }

    // Static method to retrieve zoom state
    static getZoomState(widgetId) {
        if (!NetworkWidget._zoomStates) {
            return null;
        }
        const state = NetworkWidget._zoomStates.get(widgetId);
        if (state && (Date.now() - state.timestamp < 5000)) { // Only use if less than 5 seconds old
            return state.transform;
        }
        return null;
    }

    async render() {
        return `
            <div class="cc-widget network-widget${!this.isGM ? ' not-gm' : ''}">
                <div class="network-controls-float network-controls">
                    ${this.isGM ? `
                        <button type="button" class="toggle-linking" title="Toggle linking mode">
                            <i class="fas fa-link"></i> Link Mode
                        </button>
                        <button type="button" class="add-empty-node" title="Add an empty node">
                            <i class="fas fa-circle"></i> Empty Node
                        </button>

                        
                        <button type="button" class="clear-network" title="Clear all nodes and links">
                            <i class="fas fa-trash"></i> Clear
                        </button>
                    ` : ''}
                    <button type="button" class="reset-zoom" title="Reset zoom to fit all nodes">
                        <i class="fas fa-search"></i> Zoom
                    </button>

                    <button type="button" class="toggle-fullscreen" title="Toggle fullscreen">
                        <i class="fas fa-expand"></i> Fullscreen
                    </button>
                    ${this.isGM ? `
                                            <button type="button" class="lock-nodes" title="Lock/unlock all nodes">
                        <i class="fas fa-lock"></i> <span class="lock-nodes-label">Lock </span>
                    </button>
                        <button type="button" class="export-network" title="Export network map as JSON">
                            <i class="fas fa-download"></i> Save
                        </button>
                        <button type="button" class="import-network" title="Import network map from JSON">
                            <i class="fas fa-upload"></i> Load
                        </button>
                    ` : ''}
                </div>
                <div id="network-${this.widgetId}" class="network-container"></div>
                <div class="network-instructions">
                    ${this.isGM ? 
                        'Drag actors, items, journals, scenes, or roll tables from the sidebar to add them to the network. Click "Link Mode" and click two nodes to create/remove links. Click "Add Empty Node" to add a label-only node. Click link labels to edit relationship types. Use mouse wheel to zoom.' :
                        'View relationships between documents in this network diagram. Use mouse wheel to zoom. Click nodes to open their sheets.'
                    }
                </div>
            </div>
        `;
    }

    async activateListeners(htmlElement) {
        super.activateListeners(htmlElement);
        
        // Load saved data
        const savedData = await this.getData();
        console.log('Network Widget | Raw getData() result:', savedData);
        console.log('Network Widget | Current user role:', game.user.role);
        console.log('Network Widget | Document flags:', this.document.flags);
        
        this.widgetData = savedData || { nodes: [], links: [], linkingMode: false,  selectedNodeId: null };
        console.log('Network Widget | Final widgetData after fallback:', this.widgetData);
        
        // Restore linking mode state
        this.linkingMode = this.widgetData.linkingMode || false;
this.nodesLocked = this.widgetData.nodesLocked || false;
        // Set up container
        this.container = htmlElement.querySelector(`#network-${this.widgetId}`);
        if (!this.container) {
            console.error(`Campaign Codex | Network container not found for widget ${this.widgetId}`);
            return;
        }

        // Load D3.js if not already loaded
        try {
            await this._loadD3();

        } catch (error) {
            console.error('Campaign Codex | Failed to load D3.js:', error);
            this.container.innerHTML = '<div style="padding: 20px; text-align: center; color: red;">Failed to load required libraries. Please check your internet connection.</div>';
            return;
        }
        
        // Initialize the network
        this._initializeNetwork();
        
        // Load saved nodes and links
        this._loadNetworkData();
        
        // Restore selected node after network is loaded
        this.selectedNode = null;
        if (this.linkingMode && this.widgetData.selectedNodeId) {
            this.selectedNode = this.nodes.find(node => node.id === this.widgetData.selectedNodeId);
            if (this.selectedNode) {
                console.log(`Network Widget | Restored selected node: ${this.selectedNode.name}`);
                this._highlightNode(this.selectedNode, true);
            } else {
                console.log(`Network Widget | Could not find selected node with ID: ${this.widgetData.selectedNodeId}`);
            }
        }
        
        console.log(`Network Widget | Restored state - linking mode: ${this.linkingMode}, selected node: ${this.selectedNode?.name || 'none'}`);

        if (this.isGM) {
            // Set up controls
            const linkButton = htmlElement.querySelector('.toggle-linking');
            linkButton?.addEventListener('click', this._toggleLinkingMode.bind(this));


            // Add Empty Node button
            const addEmptyNodeButton = htmlElement.querySelector('.add-empty-node');
            if (addEmptyNodeButton) {
                addEmptyNodeButton.addEventListener('click', async () => {
                    const result = await new Promise((resolve) => {
                        new foundry.applications.api.DialogV2({
                            window: { title: "Add Empty Node" },
                            content: `
                                <div style="margin-bottom: 15px;">
                                    <label for="empty-node-label" style="display: block; margin-bottom: 5px; font-weight: bold;">Label:</label>
                                    <input type="text" id="empty-node-label" placeholder="Node label..." style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
                                </div>
                            `,
                            buttons: [
                                {
                                    action: "create",
                                    label: "Create",
                                    callback: (event, button, dialog) => {
                                        const labelInput = dialog.element.querySelector('#empty-node-label');
                                        resolve({
                                            action: 'create',
                                            label: labelInput ? labelInput.value.trim() : ''
                                        });
                                    }
                                },
                                {
                                    action: "cancel",
                                    label: "Cancel",
                                    callback: () => resolve({ action: 'cancel' })
                                }
                            ],
                            default: "create"
                        }).render(true);
                    });
                    if (result.action === 'create' && result.label) {
                        // Center of network
                        const x = this.width / 2;
                        const y = this.height / 2;
                        const id = `empty-${Date.now()}-${Math.floor(Math.random()*10000)}`;
                        const newNode = {
                            id,
                            uuid: id,
                            name: result.label,
                            img: '',
                            type: 'Empty',
                            canObserve: true,
                            hiddenFromPlayers: false,
                            customName: '',
                            nodeColor: '#cccccc',
                            nodeShape: 'circle',
                            nodeSize: 30,
                            customTooltip: '',
                            x,
                            y,
                            label: result.label
                        };
                        this.nodes.push(newNode);
                        this.nodeMap.set(id, newNode);
                        this._updateNetwork();
                        await this._saveNetworkData();
                        ui.notifications.info(`Added empty node: ${result.label}`);
                    }
                });
            }

            // Restore button states
            if (this.linkingMode && linkButton) {
                linkButton.classList.add('active');
                linkButton.style.backgroundColor = '#ff6b6b';
                linkButton.style.color = 'white';
            }



            htmlElement.querySelector('.clear-network')?.addEventListener('click', this._clearNetwork.bind(this));

            // Set up drag and drop
            this.container.addEventListener('drop', this._onDrop.bind(this));
            this.container.addEventListener('dragover', this._onDragOver.bind(this), { passive: true });
            this.container.addEventListener('dragleave', this._onDragLeave.bind(this), { passive: true });
        }
        
        // Reset zoom is available for everyone
        htmlElement.querySelector('.reset-zoom')?.addEventListener('click', this._resetZoom.bind(this));
        
        // Lock nodes button (everyone)
        const lockBtn = htmlElement.querySelector('.lock-nodes');
        if (lockBtn) {
            // Restore state from widgetData
            this.nodesLocked = !!this.widgetData.nodesLocked;
            this._updateLockNodesButton(lockBtn);
            lockBtn.addEventListener('click', async () => {
                this.nodesLocked = !this.nodesLocked;
                this.widgetData.nodesLocked = this.nodesLocked;
                await this._saveNetworkData();
                // After saving, reload state from widgetData in case of refresh
                this.nodesLocked = !!this.widgetData.nodesLocked;
                this._updateLockNodesButton(lockBtn);
                this._updateNetwork();
            });
        }
        
        // Fullscreen toggle is available for everyone
        htmlElement.querySelector('.toggle-fullscreen')?.addEventListener('click', this._toggleFullscreen.bind(this));
        
        // Export and import are only for GMs
        if (this.isGM) {
            htmlElement.querySelector('.export-network')?.addEventListener('click', this._exportNetwork.bind(this));
            htmlElement.querySelector('.import-network')?.addEventListener('click', this._importNetwork.bind(this));
        }
        
        // Update instructions based on current state
        this._updateInstructions();

        // Handle image drop from file browser
        const container = htmlElement.querySelector(`#network-${this.widgetId}`);
        if (container) {
            container.addEventListener('dragover', (e) => {
                if (e.dataTransfer && e.dataTransfer.types.includes('text/plain')) {
                    const text = e.dataTransfer.getData('text/plain');
                    if (text && (text.endsWith('.png') || text.endsWith('.jpg') || text.endsWith('.jpeg') || text.endsWith('.webp') || text.endsWith('.svg'))) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                }
            }, { passive: true });
            container.addEventListener('drop', (e) => {
                if (e.dataTransfer && e.dataTransfer.types.includes('text/plain')) {
                    const text = e.dataTransfer.getData('text/plain');
                    if (text && (text.endsWith('.png') || text.endsWith('.jpg') || text.endsWith('.jpeg') || text.endsWith('.webp') || text.endsWith('.svg'))) {
                        e.preventDefault();
                        e.stopPropagation();
                        // Get drop position relative to SVG
                        const svgRect = this.svg.node().getBoundingClientRect();
                        const x = e.clientX - svgRect.left;
                        const y = e.clientY - svgRect.top;
                        this._addFloatingImage(text, x, y);
                    }
                }
            });
        }
    }

    _addFloatingImage(href, x, y) {
    const width = 100, height = 100;
    const id = `floating-img-${Date.now()}-${Math.floor(Math.random()*10000)}`;
    this.floatingImages.push({ id, href, x: x-width/2, y: y-height/2, width, height });
    this.widgetData.floatingImages = this.floatingImages;
    this.selectedFloatingImageId = id;
    console.log('Network Widget | Added floating image:', { id, href, x: x-width/2, y: y-height/2, width, height });
    console.log('Network Widget | floatingImages after add:', this.floatingImages);
    this._updateNetwork();
    this._saveNetworkData();
    }

    _onFloatingImageClick(event, d) {
        event.stopPropagation();
        // If a linked document UUID is present, open it
        if (d.linkedUuid && typeof fromUuid === 'function') {
            fromUuid(d.linkedUuid).then(doc => {
                if (doc && doc.sheet) {
                    doc.sheet.render(true);
                } else {
                    ui.notifications.warn('Linked document not found or cannot be opened.');
                }
            });
        } else {
            this.selectedFloatingImageId = d.id;
            this._updateNetwork();
        }
    }

    _onFloatingImageDragStart(event, d) {
        d3.select(event.sourceEvent.target).classed('dragging', true);
    }
    _onFloatingImageDrag(event, d) {
    d.x += event.dx;
    d.y += event.dy;
    this._updateNetwork(false);
    }
    _onFloatingImageDragEnd(event, d) {
    d3.select(event.sourceEvent.target).classed('dragging', false);
    console.log('Network Widget | _saveNetworkData called after floating image drag end');
    this._saveNetworkData();
    }


_onFloatingImageContextMenu(event, d) {
    event.preventDefault();
    event.stopPropagation();
    const aspectRatio = d.width / d.height;
    let widthValue = d.width;
    const filterValue = d.filter || '';
    const animationValue = d.animation || '';
    const linkedUuid = d.linkedUuid || '';
    const rotationValue = d.rotation || 0;
    const opacityValue = d.opacity !== undefined ? d.opacity : 100;
    const borderColor = d.borderColor || '#000000';
    const borderWidth = d.borderWidth || 0;
    const borderStyle = d.borderStyle || 'solid';
    const shadowEnabled = d.shadowEnabled !== undefined ? d.shadowEnabled : false;
    const shadowColor = d.shadowColor || '#000000';
    const shadowBlur = d.shadowBlur !== undefined ? d.shadowBlur : 5;
    const shadowOffsetX = d.shadowOffsetX !== undefined ? d.shadowOffsetX : 3;
    const shadowOffsetY = d.shadowOffsetY !== undefined ? d.shadowOffsetY : 3;
    let dialogRendered = null;
    const isLocked = d.locked || false;
    new Dialog({
        title: `Edit Image Overlay ${isLocked ? '🔒' : ''}`,
        content: `
            <form>
                <div style="margin-bottom:8px; padding:8px; background:${isLocked ? '#fff3cd' : 'transparent'}; border-radius:4px;">
                    <strong>${isLocked ? '🔒 This image is locked' : '🔓 This image is unlocked'}</strong>
                    <p style="margin:4px 0 0 0; font-size:11px; color:#666;">${isLocked ? 'Use Lock/Unlock button to enable moving and resizing' : 'Use Lock/Unlock button to prevent accidental changes'}</p>
                </div>
                <div style="margin-bottom:8px;">
                    <label>Width: <input type="number" id="img-width" value="${widthValue}" min="20" style="width:60px;"></label>
                </div>
                <div style="margin-bottom:8px;">
                    <label>Rotation: <input type="number" id="img-rotation" value="${rotationValue}" min="-360" max="360" style="width:60px;"> degrees</label>
                </div>
                <div style="margin-bottom:8px;">
                    <label>Opacity: <input type="range" id="img-opacity" value="${opacityValue}" min="0" max="100" style="width:100px; vertical-align:middle;"> <span id="opacity-value">${opacityValue}%</span></label>
                </div>
                <div style="margin-bottom:8px; padding:8px; background:#f0f0f0; border-radius:4px;">
                    <strong style="display:block; margin-bottom:6px;">Border/Frame:</strong>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:6px;">
                        <div>
                            <label style="display:block; font-size:11px; margin-bottom:2px;">Color:</label>
                            <input type="color" id="img-border-color" value="${borderColor}" style="width:100%; height:28px;">
                        </div>
                        <div>
                            <label style="display:block; font-size:11px; margin-bottom:2px;">Width (px):</label>
                            <input type="number" id="img-border-width" value="${borderWidth}" min="0" max="50" style="width:100%; padding:4px;">
                        </div>
                    </div>
                    <div>
                        <label style="display:block; font-size:11px; margin-bottom:2px;">Style:</label>
                        <select id="img-border-style" style="width:100%; padding:4px;">
                            <option value="solid" ${borderStyle === 'solid' ? 'selected' : ''}>Solid</option>
                            <option value="dashed" ${borderStyle === 'dashed' ? 'selected' : ''}>Dashed</option>
                            <option value="dotted" ${borderStyle === 'dotted' ? 'selected' : ''}>Dotted</option>
                            <option value="double" ${borderStyle === 'double' ? 'selected' : ''}>Double</option>
                            <option value="groove" ${borderStyle === 'groove' ? 'selected' : ''}>Groove</option>
                            <option value="ridge" ${borderStyle === 'ridge' ? 'selected' : ''}>Ridge</option>
                            <option value="inset" ${borderStyle === 'inset' ? 'selected' : ''}>Inset</option>
                            <option value="outset" ${borderStyle === 'outset' ? 'selected' : ''}>Outset</option>
                        </select>
                    </div>
                </div>
                <div style="margin-bottom:8px; padding:8px; background:#f0f0f0; border-radius:4px;">
                    <strong style="display:block; margin-bottom:6px;">Shadow Effects:</strong>
                    <div style="margin-bottom:6px;">
                        <label style="display:flex; align-items:center; gap:8px;">
                            <input type="checkbox" id="img-shadow-enabled" ${shadowEnabled ? 'checked' : ''}>
                            <span>Enable Drop Shadow</span>
                        </label>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:6px; opacity:${shadowEnabled ? 1 : 0.5}; pointer-events:${shadowEnabled ? 'auto' : 'none'};">
                        <div>
                            <label style="display:block; font-size:11px; margin-bottom:2px;">Color:</label>
                            <input type="color" id="img-shadow-color" value="${shadowColor}" style="width:100%; height:28px;">
                        </div>
                        <div>
                            <label style="display:block; font-size:11px; margin-bottom:2px;">Blur (px):</label>
                            <input type="number" id="img-shadow-blur" value="${shadowBlur}" min="0" max="20" style="width:100%; padding:4px;">
                        </div>
                    </div>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; opacity:${shadowEnabled ? 1 : 0.5}; pointer-events:${shadowEnabled ? 'auto' : 'none'};">
                        <div>
                            <label style="display:block; font-size:11px; margin-bottom:2px;">X Offset (px):</label>
                            <input type="number" id="img-shadow-offset-x" value="${shadowOffsetX}" min="-10" max="10" style="width:100%; padding:4px;">
                        </div>
                        <div>
                            <label style="display:block; font-size:11px; margin-bottom:2px;">Y Offset (px):</label>
                            <input type="number" id="img-shadow-offset-y" value="${shadowOffsetY}" min="-10" max="10" style="width:100%; padding:4px;">
                        </div>
                    </div>
                </div>
                <div style="margin-bottom:8px;">
                    <label>Filter: 
                        <select id="img-filter" style="width:120px;">
                            <option value="" ${filterValue === '' ? 'selected' : ''}>None</option>
                            <option value="grayscale(1)" ${filterValue === 'grayscale(1)' ? 'selected' : ''}>Grayscale</option>
                            <option value="sepia(1)" ${filterValue === 'sepia(1)' ? 'selected' : ''}>Sepia</option>
                            <option value="blur(3px)" ${filterValue === 'blur(3px)' ? 'selected' : ''}>Blur</option>
                            <option value="brightness(1.5)" ${filterValue === 'brightness(1.5)' ? 'selected' : ''}>Brighten</option>
                            <option value="contrast(2)" ${filterValue === 'contrast(2)' ? 'selected' : ''}>High Contrast</option>
                            <option value="invert(1)" ${filterValue === 'invert(1)' ? 'selected' : ''}>Invert</option>
                        </select>
                    </label>
                </div>
                <div style="margin-bottom:8px;">
                    <label>Animation: 
                        <select id="img-animation" style="width:120px;">
                            <option value="" ${animationValue === '' ? 'selected' : ''}>None</option>
                            <option value="fade" ${animationValue === 'fade' ? 'selected' : ''}>Fade</option>
                            <option value="pulse" ${animationValue === 'pulse' ? 'selected' : ''}>Pulse</option>
                            <option value="spin" ${animationValue === 'spin' ? 'selected' : ''}>Spin</option>
                        </select>
                    </label>
                </div>
                <div style="margin-bottom:8px;">
                    <label>Linked Document:</label>
                    <div id="img-linked-uuid" style="border:1px dashed #888; padding:4px; min-height:24px; background:#f8f8f8; margin-top:2px; margin-bottom:2px;"
                        data-tooltip="Drop any Actor, Item, Journal, RollTable, etc. here">
                        ${linkedUuid ? `<span style='color:#0074D9;'>${linkedUuid}</span>` : '<span style="color:#aaa;">(none)</span>'}
                    </div>
                    <button type="button" id="img-linked-clear" style="margin-top:2px;">Clear</button>
                </div>
            </form>
        `,
        buttons: {
            toggleLock: {
                label: isLocked ? 'Unlock Image' : 'Lock Image',
                callback: () => {
                    d.locked = !d.locked;
                    this._updateNetwork();
                    this._saveNetworkData();
                    ui.notifications.info(d.locked ? 'Image locked - cannot be moved or resized' : 'Image unlocked - can be moved and resized');
                },
                icon: isLocked ? '<i class="fas fa-unlock"></i>' : '<i class="fas fa-lock"></i>'
            },
            sendToFront: {
                label: 'Send to Front',
                callback: () => {
                    // Find max z-index and set this image to max + 1
                    const maxZ = Math.max(0, ...this.floatingImages.map(img => img.zIndex || 0));
                    d.zIndex = maxZ + 1;
                    this._updateNetwork();
                    this._saveNetworkData();
                    ui.notifications.info('Image moved to front');
                },
                icon: '<i class="fas fa-arrow-up"></i>'
            },
            sendToBack: {
                label: 'Send to Back',
                callback: () => {
                    // Find min z-index and set this image to min - 1
                    const minZ = Math.min(0, ...this.floatingImages.map(img => img.zIndex || 0));
                    d.zIndex = minZ - 1;
                    this._updateNetwork();
                    this._saveNetworkData();
                    ui.notifications.info('Image moved to back');
                },
                icon: '<i class="fas fa-arrow-down"></i>'
            },
            delete: {
                label: 'Delete',
                callback: () => {
                    this.floatingImages = this.floatingImages.filter(img => img.id !== d.id);
                    this.widgetData.floatingImages = this.floatingImages;
                    this.selectedFloatingImageId = null;
                    this._updateNetwork();
                    this._saveNetworkData();
                },
                icon: '<i class="fas fa-trash"></i>'
            },
            ok: {
                label: 'Save',
                callback: html => {
                    const w = parseInt(html.find('#img-width').val(), 10);
                    d.width = Math.max(20, w);
                    d.height = Math.max(20, Math.round(d.width / aspectRatio));
                    const rotation = parseInt(html.find('#img-rotation').val(), 10);
                    d.rotation = Math.max(-360, Math.min(360, rotation || 0));
                    const opacity = parseInt(html.find('#img-opacity').val(), 10);
                    d.opacity = Math.max(0, Math.min(100, opacity));
                    d.borderColor = html.find('#img-border-color').val();
                    d.borderWidth = parseInt(html.find('#img-border-width').val(), 10) || 0;
                    d.borderStyle = html.find('#img-border-style').val();
                    d.filter = html.find('#img-filter').val();
                    d.animation = html.find('#img-animation').val();
                    // Save shadow settings
                    d.shadowEnabled = html.find('#img-shadow-enabled').is(':checked');
                    d.shadowColor = html.find('#img-shadow-color').val();
                    d.shadowBlur = parseInt(html.find('#img-shadow-blur').val(), 10) || 5;
                    d.shadowOffsetX = parseInt(html.find('#img-shadow-offset-x').val(), 10) || 3;
                    d.shadowOffsetY = parseInt(html.find('#img-shadow-offset-y').val(), 10) || 3;
                    // Save linked UUID
                    d.linkedUuid = html.find('#img-linked-uuid').data('linkedUuid') || '';
                    this._updateNetwork();
                    this._saveNetworkData();
                },
                icon: '<i class="fas fa-check"></i>'
            }
        },
        default: 'ok',
        render: html => {
            dialogRendered = html;
            // Update opacity display value in real-time
            const opacitySlider = html.find('#img-opacity');
            const opacityDisplay = html.find('#opacity-value');
            opacitySlider.on('input', () => {
                opacityDisplay.text(opacitySlider.val() + '%');
            });
            // Handle shadow enable/disable toggle
            const shadowCheckbox = html.find('#img-shadow-enabled');
            const shadowControls = html.find('#img-shadow-color, #img-shadow-blur, #img-shadow-offset-x, #img-shadow-offset-y').closest('div').parent();
            shadowCheckbox.on('change', function() {
                const isEnabled = $(this).is(':checked');
                html.find('#img-shadow-color, #img-shadow-blur, #img-shadow-offset-x, #img-shadow-offset-y')
                    .prop('disabled', !isEnabled)
                    .closest('div').parent().css({
                        'opacity': isEnabled ? 1 : 0.5,
                        'pointer-events': isEnabled ? 'auto' : 'none'
                    });
            });
            // Setup drag-and-drop for linked document
            const dropZone = html.find('#img-linked-uuid');
            dropZone.on('dragover', ev => {
                ev.preventDefault();
                dropZone.css('background', '#e0f7fa');
            });
            dropZone.on('dragleave', ev => {
                dropZone.css('background', '#f8f8f8');
            });
            dropZone.on('drop', ev => {
                ev.preventDefault();
                dropZone.css('background', '#f8f8f8');
                let uuid = null;
                // Try to get UUID from Foundry drag event
                let raw = null;
                if (ev.originalEvent && ev.originalEvent.dataTransfer) {
                    const dt = ev.originalEvent.dataTransfer;
                    raw = dt.getData('text/plain') || dt.getData('text/uuid');
                } else if (ev.dataTransfer) {
                    raw = ev.dataTransfer.getData('text/plain') || ev.dataTransfer.getData('text/uuid');
                }
                if (raw) {
                    try {
                        // Try to parse as JSON, fallback to string
                        const parsed = JSON.parse(raw);
                        if (parsed && parsed.uuid) uuid = parsed.uuid;
                        else if (typeof parsed === 'string') uuid = parsed;
                    } catch {
                        uuid = raw;
                    }
                }
                if (uuid && uuid.includes('.')) {
                    dropZone.html(`<span style='color:#0074D9;'>${uuid}</span>`);
                    dropZone.data('linkedUuid', uuid);
                } else {
                    dropZone.html('<span style="color:#c00;">Invalid drop</span>');
                    dropZone.data('linkedUuid', '');
                }
            });
            // Clear button
            html.find('#img-linked-clear').on('click', ev => {
                dropZone.html('<span style="color:#aaa;">(none)</span>');
                dropZone.data('linkedUuid', '');
            });
        }
    }).render(true);
}
    _updateInstructions() {
        const instructions = this.container?.parentElement?.querySelector('.network-instructions');
        if (instructions) {
  if (this.linkingMode) {
                instructions.textContent = 'Linking Mode: Click two nodes to create/remove links between them. Use mouse wheel to zoom.';
                instructions.style.fontWeight = 'bold';
                instructions.style.color = '#ff6b6b';
            } else {
                instructions.textContent = this.isGM ? 
                    'Drag actors, items, journals, scenes, or roll tables from the sidebar to add them to the network. Click "Link Mode" and click two nodes to create/remove links. . Click link labels to edit relationship types. Use mouse wheel to zoom.' :
                    'View relationships between documents in this network diagram. Use mouse wheel to zoom. Click nodes to open their sheets.';
                instructions.style.fontWeight = '';
                instructions.style.color = '';
            }
        }
    }

    async _loadD3() {
        // Check if D3 is already loaded
        if (typeof d3 !== 'undefined') {
            return;
        }

        // Load D3.js from CDN
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://d3js.org/d3.v7.min.js';
            script.onload = () => {
                console.log('Campaign Codex | D3.js loaded successfully');
                resolve();
            };
            script.onerror = () => {
                console.error('Campaign Codex | Failed to load D3.js');
                reject(new Error('Failed to load D3.js'));
            };
            document.head.appendChild(script);
        });
    }


    _initializeNetwork() {
        d3.select(this.container).selectAll("*").remove();

        // Get container dimensions
        const containerRect = this.container.getBoundingClientRect();
        this.width = containerRect.width || 800;
        this.height = 600; // Fixed height

        // Create SVG
        this.svg = d3.select(this.container)
            .append("svg")
            .attr("width", this.width)
            .attr("height", this.height)
            .style("border", "1px solid #ccc")
         .style("background", (typeof game !== 'undefined' && game.settings) ? game.settings.get('network-widget', 'backgroundColor') : '#000000ff');

        // Add SVG filter definitions for floating image effects, only once
        let floatingDefs = this.svg.select('defs');
        if (floatingDefs.empty()) {
            floatingDefs = this.svg.append('defs');
        }
        // Only add filters if not already present
        function ensureFilter(defs, id, content) {
            if (defs.select(`#${id}`).empty()) {
                defs.append('filter').attr('id', id).html(content);
            }
        }
        ensureFilter(floatingDefs, 'floating-img-filter-grayscale', '<feColorMatrix type="saturate" values="0" />');
        ensureFilter(floatingDefs, 'floating-img-filter-sepia', '<feColorMatrix type="matrix" values="0.393 0.769 0.189 0 0 0.349 0.686 0.168 0 0 0.272 0.534 0.131 0 0 0 0 0 1 0" />');
        ensureFilter(floatingDefs, 'floating-img-filter-blur', '<feGaussianBlur stdDeviation="3" />');
        ensureFilter(floatingDefs, 'floating-img-filter-brightness', '<feComponentTransfer><feFuncR type="linear" slope="1.5"/><feFuncG type="linear" slope="1.5"/><feFuncB type="linear" slope="1.5"/></feComponentTransfer>');
        ensureFilter(floatingDefs, 'floating-img-filter-contrast', '<feComponentTransfer><feFuncR type="linear" slope="2" intercept="-0.5"/><feFuncG type="linear" slope="2" intercept="-0.5"/><feFuncB type="linear" slope="2" intercept="-0.5"/></feComponentTransfer>');
        ensureFilter(floatingDefs, 'floating-img-filter-invert', '<feComponentTransfer><feFuncR type="table" tableValues="1 0"/><feFuncG type="table" tableValues="1 0"/><feFuncB type="table" tableValues="1 0"/></feComponentTransfer>');
        
        // Add shadow filter templates (will be dynamically created with color values)
        // We'll create these dynamically in _updateNetwork based on individual image shadow settings

        // Create zoom behavior
        this.zoom = d3.zoom()
            .scaleExtent([0.1, 4])
            .on("zoom", (event) => {
                this.zoomContainer.attr("transform", event.transform);
            });

        // Apply zoom to SVG
        this.svg.call(this.zoom);

        // Create main container group that will be transformed by zoom
        this.zoomContainer = this.svg.append("g").attr("class", "zoom-container");

        // Apply saved zoom state immediately to prevent flicker
        const savedZoomState = NetworkWidget.getZoomState(this.widgetId);
        if (savedZoomState) {
            console.log('Network Widget | Applying saved zoom state during initialization');
            this.svg.call(this.zoom.transform, savedZoomState);
            // Clear the saved state since we've applied it
            if (NetworkWidget._zoomStates) {
                NetworkWidget._zoomStates.delete(this.widgetId);
            }
        }

        // Create defs for patterns/markers
        const defs = this.svg.append("defs");
        
        // Arrow marker for directed links
        // (Arrow marker removed by user request)

        // Create groups for links, nodes, and  within the zoom container
        this.zoomContainer.append("g").attr("class", "links");
        this.zoomContainer.append("g").attr("class", "nodes");

        this.zoomContainer.append("g").attr("class", "floating-images"); // Group for floating images

        // Create force simulation
        this.simulation = d3.forceSimulation()
            .force("link", d3.forceLink().id(d => d.id).distance(220))
            .force("charge", d3.forceManyBody().strength(-70))
            .force("center", d3.forceCenter(this.width / 2, this.height / 2))
            .force("collision", d3.forceCollide().radius(19));

        this.simulation.on("tick", this._tick.bind(this));
        
        // Add resize listener
        this._setupResizeHandler();
    }

    _setupResizeHandler() {
        // Handle container resize
        const resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                if (entry.target === this.container) {
                    this._handleResize();
                }
            }
        });
        
        if (this.container) {
            resizeObserver.observe(this.container);
        }
    }

    _handleResize() {
        if (!this.svg) return;
        
        const containerRect = this.container.getBoundingClientRect();
        const newWidth = containerRect.width || 800;
        
        if (Math.abs(newWidth - this.width) > 10) { // Only resize if significant change
            this.width = newWidth;
            
            this.svg
                .attr("width", this.width);
                
            // Update center force
            if (this.simulation) {
                this.simulation.force("center", d3.forceCenter(this.width / 2, this.height / 2));
                this.simulation.alpha(0.3).restart();
            }
        }
    }

    _loadNetworkData() {
        console.log('Network Widget | Raw widget data:', this.widgetData);
        
        // Load nodes
        this.nodes = (this.widgetData.nodes || []).map(nodeData => {
            // Common tooltip style fields
            const tooltipBg = nodeData.tooltipBg || '#222222';
            const tooltipColor = nodeData.tooltipColor || '#ffffff';
            const tooltipBorder = nodeData.tooltipBorder || '1px solid #888';
            const tooltipRadius = nodeData.tooltipRadius || '6px';
            const tooltipFontSize = nodeData.tooltipFontSize || '14px';
            if (nodeData.type === 'Empty') {
                return {
                    id: nodeData.id,
                    uuid: nodeData.uuid,
                    name: nodeData.name,
                    img: '',
                    type: 'Empty',
                    canObserve: true,
                    hiddenFromPlayers: false,
                    customName: '',
                    nodeColor: nodeData.nodeColor || '#cccccc',
                    nodeShape: nodeData.nodeShape || 'circle',
                    nodeSize: nodeData.nodeSize || 30,
                    customTooltip: nodeData.customTooltip || '',
                    x: nodeData.x || Math.random() * this.width,
                    y: nodeData.y || Math.random() * this.height,
                    label: nodeData.label || nodeData.name,
                    textColor: nodeData.textColor || '#444444',
                    tooltipBg,
                    tooltipColor,
                    tooltipBorder,
                    tooltipRadius,
                    tooltipFontSize
                };
            } else {
                return {
                    id: nodeData.id,
                    uuid: nodeData.uuid,
                    name: nodeData.name,
                    img: nodeData.img,
                    type: nodeData.type || 'Actor',
                    canObserve: nodeData.canObserve !== false,
                    hiddenFromPlayers: nodeData.hiddenFromPlayers || false,
                    customName: nodeData.customName || '',
                    nodeColor: nodeData.nodeColor || '#69b3a2',
                    nodeShape: nodeData.nodeShape || 'circle',
                    nodeSize: nodeData.nodeSize || 30,
                    customTooltip: nodeData.customTooltip || nodeData.customName || nodeData.name || '',
                    x: nodeData.x || Math.random() * this.width,
                    y: nodeData.y || Math.random() * this.height,
                    tooltipBg,
                    tooltipColor,
                    tooltipBorder,
                    tooltipRadius,
                    tooltipFontSize
                };
            }
        });

        // Load links with safety check
        this.links = (this.widgetData.links || []).map(linkData => ({
            source: linkData.source,
            target: linkData.target,
            label: linkData.label || ''
        }));




        // Load floating images
        this.floatingImages = (this.widgetData.floatingImages || []).map(img => ({
            id: img.id,
            href: img.href,
            x: img.x,
            y: img.y,
            width: img.width,
            height: img.height,
            filter: img.filter || '',
            animation: img.animation || '',
            linkedUuid: img.linkedUuid || '',
            rotation: img.rotation || 0,
            opacity: img.opacity !== undefined ? img.opacity : 100,
            zIndex: img.zIndex || 0,
            locked: img.locked || false,
            borderColor: img.borderColor || '#000000',
            borderWidth: img.borderWidth || 0,
            borderStyle: img.borderStyle || 'solid',
            shadowEnabled: img.shadowEnabled !== undefined ? img.shadowEnabled : false,
            shadowColor: img.shadowColor || '#000000',
            shadowBlur: img.shadowBlur !== undefined ? img.shadowBlur : 5,
            shadowOffsetX: img.shadowOffsetX !== undefined ? img.shadowOffsetX : 3,
            shadowOffsetY: img.shadowOffsetY !== undefined ? img.shadowOffsetY : 3
        }));
        console.log('Network Widget | Loaded floatingImages:', this.floatingImages);

        console.log(`Network Widget | Loaded ${this.nodes.length} nodes, ${this.links.length} links}`);
        console.log('Network Widget | Links data:', this.links);


        // Update node map
        this.nodeMap.clear();
        this.nodes.forEach(node => {
            this.nodeMap.set(node.uuid, node);
        });

        this._updateNetwork(false); // Allow initial zoom setup
    }

    _updateNetwork(preserveZoom = true) {
      //  console.log(`Network Widget | Updating network with ${this.nodes.length} nodes and ${this.links.length} links`);
        
        // Store current transform if preserving zoom
        let currentTransform = null;
        if (preserveZoom && this.zoomContainer) {
            currentTransform = d3.zoomTransform(this.zoomContainer.node());
        }
        

        // Get user settings for colors
        let linkColor = '#ffffffff';
        let nodeLabelColor = '#efe5e5ff';
        let linkLabelOutlineColor = '#ad1313ff';
        if (typeof game !== 'undefined' && game.settings) {
            try { linkColor = game.settings.get('network-widget', 'linkColor') || '#ffffffff'; } catch {}
            try { nodeLabelColor = game.settings.get('network-widget', 'nodeLabelColor') || '#fdfdfdff'; } catch {}
            try { linkLabelOutlineColor = game.settings.get('network-widget', 'linkLabelOutlineColor') || '#c00606ff'; } catch {}
        }

        // Update links
        this.linkElements = this.zoomContainer.select(".links")
            .selectAll("g")
            .data(this.links);

        const linkEnter = this.linkElements.enter()
            .append("g")
            .attr("class", "link-group");

        // Add link lines
        linkEnter.append("line")
            .attr("class", "link")
            .attr("stroke", linkColor)
            .attr("stroke-width", 2);


        // Add link labels with outline
        linkEnter.append("text")
            .attr("class", "link-label")
            .attr("text-anchor", "middle")
            .attr("dy", -5)
            .text(d => d.label || (this.isGM ? 'Click to label' : ''))
            .classed("clickable", this.isGM)
            .classed("empty", d => !d.label)
            .style("cursor", this.isGM ? "pointer" : "default")
            .style("fill", linkColor)
            .style("stroke", linkLabelOutlineColor)
            .style("stroke-width", 3)
            .style("paint-order", "stroke")
            .style("stroke-linejoin", "round")
            .on("click", (event, d) => {
                if (this.isGM) {
                    event.stopPropagation();
                    this._editLinkLabel(d);
                }
            });

        this.linkElements = linkEnter.merge(this.linkElements);

        // Update all link labels (both new and existing)

        this.linkElements.selectAll(".link-label")
            .text(d => d.label || (this.isGM ? 'Click to label' : ''))
            .classed("clickable", this.isGM)
            .classed("empty", d => !d.label)
            .style("cursor", this.isGM ? "pointer" : "default")
            .style("fill", linkColor)
            .style("stroke", linkLabelOutlineColor)
            .style("stroke-width", 3)
            .style("paint-order", "stroke")
            .style("stroke-linejoin", "round");

        // Update all link lines
        this.linkElements.selectAll(".link")
            .attr("stroke", linkColor);

        // Remove old links
        this.linkElements.exit().remove();

        // Update nodes
        this.nodeElements = this.zoomContainer.select(".nodes")
            .selectAll("g")
            .data(this.nodes);

        const nodeEnter = this.nodeElements.enter()
            .append("g")
            .attr("class", "node-group");

        // Always remove drag behavior first
        nodeEnter.on('.drag', null);
        // Only add drag behavior for GMs, unless nodesLocked is true
        if (this.isGM && !this.nodesLocked) {
            nodeEnter.call(d3.drag()
                .on("start", this._dragstarted.bind(this))
                .on("drag", this._dragged.bind(this))
                .on("end", this._dragended.bind(this)));
        }
        // Also update drag for all existing nodes
        this.nodeElements.on('.drag', null);
        if (this.isGM && !this.nodesLocked) {
            this.nodeElements.call(d3.drag()
                .on("start", this._dragstarted.bind(this))
                .on("drag", this._dragged.bind(this))
                .on("end", this._dragended.bind(this)));
        }

        // Remove any previous custom tooltip div
        d3.select('.network-html-tooltip').remove();
        // Create a single tooltip div for all nodes
        const tooltip = d3.select('body')
            .append('div')
            .attr('class', 'd3-tip network-html-tooltip')
            .style('position', 'absolute')
            .style('visibility', 'hidden');

        let isDraggingNode = false;
        function showTooltip(event, d) {
            if (isDraggingNode) return;
            // For empty nodes, show label or customTooltip if present
            if (d.type === 'Empty') {
                let html = (d.customTooltip && d.customTooltip.trim())
                    ? d.customTooltip
                    : `<div style='font-weight:bold;'>${d.label || d.name}</div>`;
                tooltip.html(html)
                    .style('background', d.tooltipBg || '#222222')
                    .style('color', d.tooltipColor || '#ffffff')
                    .style('border', d.tooltipBorder || '1px solid #888')
                    .style('border-radius', d.tooltipRadius || '6px')
                    .style('font-size', d.tooltipFontSize || '14px')
                    .style('padding', '8px 12px')
                    .style('box-shadow', '0 2px 8px rgba(0,0,0,0.18)')
                    .style('z-index', 10000)
                    .style('visibility', 'visible');
                return;
            }
            let html = d.customTooltip && d.customTooltip.trim()
                ? d.customTooltip
                : `<div style='font-weight:bold;'>${this._getNodeDisplayName(d)}</div>`;
            tooltip.html(html)
                .style('background', d.tooltipBg || '#222222')
                .style('color', d.tooltipColor || '#ffffff')
                .style('border', d.tooltipBorder || '1px solid #888')
                .style('border-radius', d.tooltipRadius || '6px')
                .style('font-size', d.tooltipFontSize || '14px')
                .style('padding', '8px 12px')
                .style('box-shadow', '0 2px 8px rgba(0,0,0,0.18)')
                .style('z-index', 10000)
                .style('visibility', 'visible');
        }
        function moveTooltip(event) {
            // Calculate intended position
            const padding = 8; // space from edge
            // Temporarily set position to measure size
            tooltip.style('top', '-9999px').style('left', '-9999px').style('visibility', 'visible');
            const rect = tooltip.node().getBoundingClientRect();
            let top = event.clientY + 18;
            let left = event.clientX - 10;
            // Check right edge
            if (left + rect.width + padding > window.innerWidth) {
                left = event.clientX - rect.width - 10;
            }
            // Check left edge
            if (left < padding) {
                left = padding;
            }
            // Check bottom edge
            if (top + rect.height + padding > window.innerHeight) {
                top = event.clientY - rect.height - 10;
            }
            // Check top edge
            if (top < padding) {
                top = padding;
            }
            tooltip.style('top', top + 'px').style('left', left + 'px');
        }
        function hideTooltip() {
            tooltip.style('visibility', 'hidden');
        }
        nodeEnter
            .on('mouseover', function(event, d) {
                if (!this.linkingMode) showTooltip.call(this, event, d);
            }.bind(this))
            .on('mousemove', function(event) {
                if (!this.linkingMode) moveTooltip(event);
            }.bind(this))
            .on('mouseout', hideTooltip)
            .on('mousedown', hideTooltip)
            .on('mouseup',  hideTooltip)
            .on('touchstart', hideTooltip);
        // Remove any SVG <title> (for update)
        nodeEnter.select('title').remove();

        // Add node shapes with conditional styling
        nodeEnter.each((d, i, nodes) => {
            const nodeGroup = d3.select(nodes[i]);
            const size = d.nodeSize || 30;
            const shape = d.nodeShape || 'circle';
            const color = this._getNodeFillColor(d);
            const stroke = this._getNodeStrokeColor(d);
            const strokeWidth = this._getNodeStrokeWidth(d);
            
            // Create the appropriate shape
            if (shape === 'circle') {
                nodeGroup.append("circle")
                    .attr("class", "node")
                    .attr("r", size)
                    .attr("fill", color)
                    .attr("stroke", stroke)
                    .attr("stroke-width", strokeWidth);
            } else if (shape === 'square') {
                nodeGroup.append("rect")
                    .attr("class", "node")
                    .attr("x", -size)
                    .attr("y", -size)
                    .attr("width", size * 2)
                    .attr("height", size * 2)
                    .attr("fill", color)
                    .attr("stroke", stroke)
                    .attr("stroke-width", strokeWidth);
            } else if (shape === 'diamond') {
                const points = [
                    [0, -size],
                    [size, 0],
                    [0, size],
                    [-size, 0]
                ].map(p => p.join(',')).join(' ');
                
                nodeGroup.append("polygon")
                    .attr("class", "node")
                    .attr("points", points)
                    .attr("fill", color)
                    .attr("stroke", stroke)
                    .attr("stroke-width", strokeWidth);
            } else if (shape === 'star') {
                const outerRadius = size;
                const innerRadius = size * 0.4;
                const points = [];
                for (let i = 0; i < 10; i++) {
                    const radius = i % 2 === 0 ? outerRadius : innerRadius;
                    const angle = (i * Math.PI) / 5 - Math.PI / 2;
                    points.push([
                        radius * Math.cos(angle),
                        radius * Math.sin(angle)
                    ]);
                }
                
                nodeGroup.append("polygon")
                    .attr("class", "node")
                    .attr("points", points.map(p => p.join(',')).join(' '))
                    .attr("fill", color)
                    .attr("stroke", stroke)
                    .attr("stroke-width", strokeWidth);
            }
        });

        // Add node images - show image based on visibility rules
    // Add SVG clipPaths for each node image shape

    // Helper to sanitize node IDs for use in SVG IDs/selectors
    function sanitizeId(id) {
        return String(id).replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    const nodeDefs = this.svg.select('defs').empty() ? this.svg.append('defs') : this.svg.select('defs');
    nodeEnter.each((d, i, nodes) => {
        const nodeGroup = d3.select(nodes[i]);
        const nodeSize = d.nodeSize || 30;
        let imageSize;
        const shape = d.nodeShape || 'circle';
        if (shape === 'star') {
            imageSize = nodeSize * 1.5;
        } else if (shape === 'diamond') {
            imageSize = nodeSize * 1.8;
        } else if (shape === 'square') {
            imageSize = nodeSize * 2 * 0.90;
        } else {
            imageSize = nodeSize * 2 * 0.90;
        }

        // Unique, sanitized clipPath id per node (by id and shape)
        const rawId = d.id || i;
        const clipId = `node-clip-${sanitizeId(rawId)}-${shape}`;
        // Remove any existing clipPath for this node/shape
        nodeDefs.select(`#${clipId}`).remove();
        // Create the correct clipPath shape
        if (shape === 'circle') {
            nodeDefs.append('clipPath')
                .attr('id', clipId)
                .append('circle')
                .attr('cx', 0)
                .attr('cy', 0)
                .attr('r', imageSize/2);
        } else if (shape === 'square') {
            nodeDefs.append('clipPath')
                .attr('id', clipId)
                .append('rect')
                .attr('x', -imageSize/2)
                .attr('y', -imageSize/2)
                .attr('width', imageSize)
                .attr('height', imageSize);
        } else if (shape === 'diamond') {
            const points = [
                [0, -imageSize/2],
                [imageSize/2, 0],
                [0, imageSize/2],
                [-imageSize/2, 0]
            ].map(p => p.join(',')).join(' ');
            nodeDefs.append('clipPath')
                .attr('id', clipId)
                .append('polygon')
                .attr('points', points);
        } else if (shape === 'star') {
            // 5-pointed star
            const outerRadius = imageSize/2;
            const innerRadius = outerRadius * 0.4;
            const points = [];
            for (let j = 0; j < 10; j++) {
                const radius = j % 2 === 0 ? outerRadius : innerRadius;
                const angle = (j * Math.PI) / 5 - Math.PI / 2;
                points.push([
                    radius * Math.cos(angle),
                    radius * Math.sin(angle)
                ]);
            }
            nodeDefs.append('clipPath')
                .attr('id', clipId)
                .append('polygon')
                .attr('points', points.map(p => p.join(',')).join(' '));
        }

        if (this._shouldShowNodeContent(d)) {
            nodeGroup.append('image')
                .attr('class', 'node-image')
                .attr('x', -imageSize/2)
                .attr('y', -imageSize/2)
                .attr('width', imageSize)
                .attr('height', imageSize)
                .attr('clip-path', `url(#${clipId})`)
                .attr('href', d.img);
        } else {
            // Show question marks for hidden/non-observable entities
            const questionText = this._getQuestionMarkText(d);
            const bgColor = this._getQuestionMarkBgColor(d);
            const fontSize = this._getQuestionMarkFontSize(d, nodeSize);
            nodeGroup.append('circle')
                .attr('class', 'node-unknown')
                .attr('r', imageSize/2)
                .attr('fill', bgColor)
                .attr('stroke', '#333')
                .attr('stroke-width', 2);
            nodeGroup.append('text')
                .attr('class', 'node-question')
                .attr('text-anchor', 'middle')
                .attr('dy', fontSize === '20px' ? 4 : 8)
                .attr('font-size', fontSize)
                .attr('font-weight', 'bold')
                .attr('fill', '#fff')
                .text(questionText);
        }
    });


        // Add node labels with conditional display names and positioning
        nodeEnter.append("text")
            .attr("class", "node-label")
            .attr("text-anchor", "middle")
            .attr("dy", d => d.type === 'Empty' ? 4 : (d.nodeSize || 30) + 15)
            .attr("font-size", d => d.type === 'Empty' ? '16px' : '12px')
            .attr("font-weight", "bold")
            .attr("fill", nodeLabelColor)
            .text(d => d.type === 'Empty' ? d.label || d.name : this._getNodeDisplayName(d));

        this.nodeElements = nodeEnter.merge(this.nodeElements);


        // Update existing nodes to reflect any changes in customization
        this.nodeElements.selectAll('.node-label')
            .text(d => d.type === 'Empty' ? d.label || d.name : this._getNodeDisplayName(d))
            .attr("dy", d => d.type === 'Empty' ? 4 : (d.nodeSize || 30) + 15)
            .attr("fill", nodeLabelColor);

        // Remove any SVG <title> from updated nodes
        this.nodeElements.selectAll('title').remove();
        // Attach tooltip events to all nodes

        this.nodeElements
            .on('mouseover', function(event, d) {
                if (!this.linkingMode) showTooltip.call(this, event, d);
            }.bind(this))
            .on('mousemove', function(event) {
                if (!this.linkingMode) moveTooltip(event);
            }.bind(this))
            .on('mouseout', hideTooltip)
            .on('mousedown', hideTooltip)
            .on('mouseup', hideTooltip)
            .on('touchstart', hideTooltip)
            .on('click', (event, d) => {
                hideTooltip();
                this._onNodeClick(event, d);
            });

        // Remove old nodes
        this.nodeElements.exit().remove();

        // Add click handlers for GM
        if (this.isGM) {
            this.nodeElements.on("click", this._onNodeClick.bind(this));
            this.nodeElements.on("contextmenu", this._onNodeRightClick.bind(this));
        } else {
            this.nodeElements.on("click", this._onNodeClick.bind(this));
        }

        // --- Floating Images Layer ---
        let floatingImagesGroup = this.zoomContainer.select('.floating-images');
        if (floatingImagesGroup.empty()) {
            // Always insert as the very first group so images are below everything
            floatingImagesGroup = this.zoomContainer.insert('g', ':first-child').attr('class', 'floating-images');
        } else {
            // Move to first if not already
            const node = floatingImagesGroup.node();
            if (node && node !== this.zoomContainer.node().firstChild) {
                this.zoomContainer.node().insertBefore(node, this.zoomContainer.node().firstChild);
            }
        }
        // Sort images by zIndex so they render in correct order (lower zIndex renders first, appears behind)
        const sortedImages = [...this.floatingImages].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
        let images = floatingImagesGroup.selectAll('.floating-image').data(sortedImages, d => d.id);
        const imagesEnter = images.enter().append('g')
            .attr('class', 'floating-image')
            .attr('transform', d => `translate(${d.x},${d.y})`);
        if (this.isGM) {
            imagesEnter.each((d, i, nodes) => {
                const group = d3.select(nodes[i]);
                // Only add drag if not locked
                if (!d.locked) {
                    group.call(d3.drag()
                        .on('start', (event, d) => this._onFloatingImageDragStart(event, d))
                        .on('drag', (event, d) => this._onFloatingImageDrag(event, d))
                        .on('end', (event, d) => this._onFloatingImageDragEnd(event, d))
                    );
                }
                group.on('click', (event, d) => this._onFloatingImageClick(event, d))
                    .on('contextmenu', (event, d) => this._onFloatingImageContextMenu(event, d));
            });
        }
        // Map filter string to SVG filter id
        function getSvgFilterId(filter) {
            switch (filter) {
                case 'grayscale(1)': return 'url(#floating-img-filter-grayscale)';
                case 'sepia(1)': return 'url(#floating-img-filter-sepia)';
                case 'blur(3px)': return 'url(#floating-img-filter-blur)';
                case 'brightness(1.5)': return 'url(#floating-img-filter-brightness)';
                case 'contrast(2)': return 'url(#floating-img-filter-contrast)';
                case 'invert(1)': return 'url(#floating-img-filter-invert)';
                default: return null;
            }
        }
        // Add border rectangle if border is enabled
        imagesEnter.each((d, i, nodes) => {
            if (d.borderWidth > 0) {
                const group = d3.select(nodes[i]);
                group.insert('rect', ':first-child')
                    .attr('class', d => d.animation ? `image-border floating-img-anim-${d.animation}` : 'image-border')
                    .attr('x', -d.borderWidth)
                    .attr('y', -d.borderWidth)
                    .attr('width', d.width + d.borderWidth * 2)
                    .attr('height', d.height + d.borderWidth * 2)
                    .attr('transform', d => d.rotation ? `rotate(${d.rotation} ${d.width/2} ${d.height/2})` : null)
                    .attr('fill', 'none')
                    .attr('stroke', d.borderColor)
                    .attr('stroke-width', d.borderWidth)
                    .style('stroke-dasharray', d.borderStyle === 'dashed' ? '10,5' : (d.borderStyle === 'dotted' ? '2,2' : 'none'))
                    .style('pointer-events', 'none');
            }
        });
        imagesEnter.append('image')
            .attr('xlink:href', d => d.href)
            .attr('href', d => d.href)
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', d => d.width)
            .attr('height', d => d.height)
            .attr('transform', d => d.rotation ? `rotate(${d.rotation} ${d.width/2} ${d.height/2})` : null)
            .attr('class', d => d.animation ? `floating-img-anim-${d.animation}` : null)
            .style('pointer-events', 'all')
            .style('opacity', d => (d.opacity !== undefined ? d.opacity : 100) / 100)
            .style('filter', d => this._getImageFilter(d))
            .style('cursor', d => d.locked ? 'not-allowed' : 'move');
        // Add lock indicator if locked
        imagesEnter.each((d, i, nodes) => {
            if (d.locked) {
                const group = d3.select(nodes[i]);
                group.append('text')
                    .attr('class', 'lock-indicator')
                    .attr('x', 5)
                    .attr('y', 20)
                    .attr('font-size', '16px')
                    .attr('fill', '#ff6b6b')
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 2)
                    .attr('paint-order', 'stroke')
                    .text('🔒');
            }
        });
        // Add resize handles if selected AND unlocked
        // Resize handles removed (unused)
        // Update borders
        images.selectAll('.image-border').remove();
        images.each((d, i, nodes) => {
            if (d.borderWidth > 0) {
                const group = d3.select(nodes[i]);
                group.insert('rect', ':first-child')
                    .attr('class', d => d.animation ? `image-border floating-img-anim-${d.animation}` : 'image-border')
                    .attr('x', -d.borderWidth)
                    .attr('y', -d.borderWidth)
                    .attr('width', d.width + d.borderWidth * 2)
                    .attr('height', d.height + d.borderWidth * 2)
                    .attr('transform', d => d.rotation ? `rotate(${d.rotation} ${d.width/2} ${d.height/2})` : null)
                    .attr('fill', 'none')
                    .attr('stroke', d.borderColor)
                    .attr('stroke-width', d.borderWidth)
                    .style('stroke-dasharray', d.borderStyle === 'dashed' ? '10,5' : (d.borderStyle === 'dotted' ? '2,2' : 'none'))
                    .style('pointer-events', 'none');
            }
        });
        // Always update filter and animation class on update selection
        images.select('image')
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', d => d.width)
            .attr('height', d => d.height)
            .attr('transform', d => d.rotation ? `rotate(${d.rotation} ${d.width/2} ${d.height/2})` : null)
            .attr('class', d => d.animation ? `floating-img-anim-${d.animation}` : null)
            .style('pointer-events', 'all')
            .style('opacity', d => (d.opacity !== undefined ? d.opacity : 100) / 100)
            .style('filter', d => this._getImageFilter(d))
            .style('cursor', d => d.locked ? 'not-allowed' : 'move');
        // Update lock indicators
        images.selectAll('.lock-indicator').remove();
        images.each((d, i, nodes) => {
            if (d.locked) {
                const group = d3.select(nodes[i]);
                group.append('text')
                    .attr('class', 'lock-indicator')
                    .attr('x', 5)
                    .attr('y', 20)
                    .attr('font-size', '16px')
                    .attr('fill', '#ff6b6b')
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 2)
                    .attr('paint-order', 'stroke')
                    .text('🔒');
            }
        });
        // Update drag handlers based on locked state
        if (this.isGM) {
            images.each((d, i, nodes) => {
                const group = d3.select(nodes[i]);
                // Remove existing drag behavior
                group.on('.drag', null);
                // Only re-add if not locked
                if (!d.locked) {
                    group.call(d3.drag()
                        .on('start', (event, d) => this._onFloatingImageDragStart(event, d))
                        .on('drag', (event, d) => this._onFloatingImageDrag(event, d))
                        .on('end', (event, d) => this._onFloatingImageDragEnd(event, d))
                    );
                }
            });
        }
        // Update group position on update
        images.attr('transform', d => `translate(${d.x},${d.y})`);
        images.exit().remove();


        // Update simulation
        this.simulation.nodes(this.nodes);
        this.simulation.force("link").links(this.links);
        
        // Use a gentler alpha restart to avoid jarring movements
        this.simulation.alpha(0.3).restart();
        
        // Restore the zoom transform if preserving zoom
        if (preserveZoom && currentTransform && this.svg) {
            // Apply transform without animation to avoid jarring movement
            this.svg.call(this.zoom.transform, currentTransform);
        }
    }




    _tick() {
        // Update link positions
        this.linkElements.selectAll("line")
            .attr("x1", d => d.source.x)
            .attr("y1", d => d.source.y)
            .attr("x2", d => d.target.x)
            .attr("y2", d => d.target.y);

        this.linkElements.selectAll("text")
            .attr("x", d => (d.source.x + d.target.x) / 2)
            .attr("y", d => (d.source.y + d.target.y) / 2);

        // Update node positions
        this.nodeElements.attr("transform", d => `translate(${d.x},${d.y})`);
    }

    _dragstarted(event, d) {
        if (!event.active) this.simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
        
        // Disable zoom during drag
        this.svg.on(".zoom", null);
    }

    _dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }

    _dragended(event, d) {
        if (!event.active) this.simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
        
        // Re-enable zoom after drag
        this.svg.call(this.zoom);
        
        // Save position
        this._saveNetworkData();
    }

    _resetZoom() {
        if (!this.svg || !this.zoom) return;
        
        if (this.nodes.length === 0) {
            // No nodes, just reset to center
            this.svg.transition()
                .duration(750)
                .call(this.zoom.transform, d3.zoomIdentity);
        } else {
            // Calculate bounds of all nodes
            const bounds = this._calculateNodeBounds();
            
            // Add padding
            const padding = 50;
            const fullWidth = this.width;
            const fullHeight = this.height;
            const width = bounds.maxX - bounds.minX + padding * 2;
            const height = bounds.maxY - bounds.minY + padding * 2;
            
            // Calculate scale to fit
            const scale = Math.min(fullWidth / width, fullHeight / height, 1);
            
            // Calculate center offset
            const translateX = (fullWidth - width * scale) / 2 - bounds.minX * scale + padding * scale;
            const translateY = (fullHeight - height * scale) / 2 - bounds.minY * scale + padding * scale;
            
            this.svg.transition()
                .duration(750)
                .call(this.zoom.transform, d3.zoomIdentity.translate(translateX, translateY).scale(scale));
        }
    }

    _calculateNodeBounds() {
        if (this.nodes.length === 0) {
            return { minX: 0, minY: 0, maxX: this.width, maxY: this.height };
        }
        
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        
        this.nodes.forEach(node => {
            minX = Math.min(minX, node.x - 30); // Account for node radius
            minY = Math.min(minY, node.y - 30);
            maxX = Math.max(maxX, node.x + 30);
            maxY = Math.max(maxY, node.y + 30);
        });
        
        return { minX, minY, maxX, maxY };
    }

    async _onNodeClick(event, d) {
        // Prevent default to avoid interfering with zoom
        event.stopPropagation();
        
        console.log(`Network Widget | Node clicked: ${d.name}, linking mode: ${this.linkingMode}, selected node: ${this.selectedNode?.name || 'none'}`);
        
        if (this.isGM && (this.linkingMode)) {
            // GM in linking mode - handle node linking
            if (!this.selectedNode) {
                // First node selection
                this.selectedNode = d;
                this._highlightNode(d, true);
                
                // Save selected node state
                this.widgetData.selectedNodeId = d.id;
                this.saveDataTemporal(this.widgetData);
                
                console.log(`Network Widget | Selected first node: ${d.name}`);
                ui.notifications.info(`Selected ${d.name}. Click another node to link/unlink.`);
            } else if (this.selectedNode === d) {
                // Deselect same node
                this._highlightNode(d, false);
                this.selectedNode = null;
                
                // Clear selected node state
                this.widgetData.selectedNodeId = null;
                this.saveDataTemporal(this.widgetData);
                
                console.log(`Network Widget | Deselected node: ${d.name}`);
                ui.notifications.info("Node deselected.");
            } else {
                // Second node selection - create or remove link
                console.log(`Network Widget | Creating/removing link between ${this.selectedNode.name} and ${d.name}`);
                await this._toggleLink(this.selectedNode, d);
                this._highlightNode(this.selectedNode, false);
                this.selectedNode = null;
                
                // Clear selected node state
                this.widgetData.selectedNodeId = null;
                this.saveDataTemporal(this.widgetData);
            }
        } else {
            // Not in linking mode or not GM - open document sheet, but not for empty nodes
            if (d.type === 'Empty') {
                // Do nothing (allow drag, link, context menu)
                return;
            }
            console.log(`Network Widget | Opening ${d.type || 'document'} sheet for: ${d.name}`);
            if (d.uuid && d.canObserve) {
                this._onOpenDocument(d.uuid, d.type || "Actor");
            } else if (!d.canObserve) {
                ui.notifications.warn("You don't have permission to view this document.");
            }
        }
    }

    _onNodeRightClick(event, d) {
        if (!this.isGM) return;
        
        event.preventDefault();
        
        // Get current hidden state (backwards compatible)
        const isHidden = d.hiddenFromPlayers || false;
        
        new foundry.applications.api.DialogV2({
            window: { title: `${d.name} Customization`, width: 400 },
            content: `

<div style="display: flex; gap: 12px; align-items: flex-start; margin: 2px 0; padding: 2px;">
    <div style="flex: 65 1 0;">
        <h4 style="margin: 0 0 8px 0; font-size: 14px;">Display Name</h4>
        <input type="text" id="custom-name" value="${d.label || d.name || ''}" placeholder="Leave empty to use original name" 
               style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px;">
        <p style="margin: 2px 0 0 0; font-size: 11px; color: #666;">
            Custom label for this node (visible to everyone)
        </p>
        ${d.type === 'Empty' ? `
        <div style="margin-top: 4px;">
            <label style="display: block; font-size: 12px; margin-bottom: 3px;">Text Color:</label>
            <input type="color" id="empty-text-color" value="${d.textColor || '#444444'}" style="width: 100%; height: 30px; border: 1px solid #ccc; border-radius: 3px;">
        </div>
        ` : ''}
    </div>
    <div style="flex: 35 1 0; display: flex; flex-direction: column; align-items: flex-start; justify-content: flex-start;">
        <h4 style="margin: 0 0 8px 0; font-size: 14px;">Visibility</h4>
        <label style="display: flex; align-items: center; cursor: pointer;">
            <input type="checkbox" id="hidden-checkbox" ${isHidden ? 'checked' : ''} style="margin-right: 8px;">
            <span>Hidden from Players</span>
        </label>
        <p style="margin: 2px 0 0 0; font-size: 11px; color: #666;">
            Players see black circle with "?????"
        </p>
    </div>
</div>

                <!-- Image URL Section for non-empty nodes -->
                ${d.type !== 'Empty' ? `
                <div style="margin: 2px 0; padding: 2px;">
                    <h4 style="margin: 0 0 4px 0; font-size: 14px;">Image URL</h4>
                    <input type="text" id="node-img-url" value="${d.img || ''}" placeholder="Paste image URL or path here" 
                           style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px;">
                    <p style="margin: 2px 0 0 0; font-size: 11px; color: #666;">
                        Change the image for this node (actor, item, scene, etc.)
                    </p>
                </div>
                ` : ''}

                <!-- Appearance Section -->
                <div style="margin: 5px 0; padding: 2px;">
                    <h4 style="margin: 0 0 2px 0; font-size: 14px;">Appearance</h4>
                    <div style="display: flex; gap: 12px; margin-bottom: 10px; align-items: flex-end;">
                        <div style="flex: 1 1 0; min-width: 90px;">
                            <label style="display: block; font-size: 12px; margin-bottom: 3px;">Color:</label>
                            <input type="color" id="node-color" value="${d.nodeColor || '#69b3a2'}" 
                                   style="width: 100%; height: 30px; border: 1px solid #ccc; border-radius: 3px;">
                        </div>
                        <div style="flex: 1 1 0; min-width: 120px;">
                            <label style="display: block; font-size: 12px; margin-bottom: 3px;">Size:</label>
                            <select id="node-size" style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px;">
                                <option value="20" ${(d.nodeSize || 30) === 20 ? 'selected' : ''}>Small (20px)</option>
                                <option value="30" ${(d.nodeSize || 30) === 30 ? 'selected' : ''}>Normal (30px)</option>
                                <option value="40" ${(d.nodeSize || 30) === 40 ? 'selected' : ''}>Large (40px)</option>
                                <option value="50" ${(d.nodeSize || 30) === 50 ? 'selected' : ''}>XL (50px)</option>
                                <option value="70" ${(d.nodeSize || 30) === 70 ? 'selected' : ''}>XXL (70px)</option>
                            </select>
                        </div>
                        <div style="flex: 1 1 0; min-width: 120px;">
                            <label style="display: block; font-size: 12px; margin-bottom: 3px;">Shape:</label>
                            <select id="node-shape" style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px;">
                                <option value="circle" ${(d.nodeShape || 'circle') === 'circle' ? 'selected' : ''}>Circle</option>
                                <option value="square" ${(d.nodeShape || 'circle') === 'square' ? 'selected' : ''}>Square</option>
                                <option value="diamond" ${(d.nodeShape || 'circle') === 'diamond' ? 'selected' : ''}>Diamond</option>
                                <option value="star" ${(d.nodeShape || 'circle') === 'star' ? 'selected' : ''}>Star</option>
                            </select>
                        </div>
                    </div>
                </div>

                <!-- Tooltip Section -->
                <div style="margin: 5px 0; padding: 2px;">
                    <h4 style="margin: 0 0 8px 0; font-size: 14px;">Custom Tooltip</h4>
                    <textarea id="custom-tooltip" placeholder="Leave empty to use display name" 
                              style="width: 100%; padding: 4px; border: 1px solid #ccc; border-radius: 3px; height: 48px; resize: vertical; font-size: 13px;">${d.customTooltip || ''}</textarea>
                    <div style="display: flex; gap: 10px; margin-top: 8px; align-items: flex-end;">
                        <div style="flex: 1 1 0; min-width: 80px;">
                            <label style="display: block; font-size: 12px; margin-bottom: 2px;">Tooltip Background:</label>
                            <input type="color" id="tooltip-bg" value="${d.tooltipBg || '#222222'}" style="width: 32px; height: 24px; border: 1px solid #ccc; border-radius: 3px;">
                        </div>
                        <div style="flex: 1 1 0; min-width: 80px;">
                            <label style="display: block; font-size: 12px; margin-bottom: 2px;">Tooltip Text Color:</label>
                            <input type="color" id="tooltip-color" value="${d.tooltipColor || '#ffffff'}" style="width: 32px; height: 24px; border: 1px solid #ccc; border-radius: 3px;">
                        </div>
                        <div style="flex: 2 1 0; min-width: 120px;">
                            <label style="display: block; font-size: 12px; margin-bottom: 2px;">Tooltip Border:</label>
                            <div style="display: flex; gap: 4px; align-items: center;">
                                <input type="text" id="tooltip-border-width" value="${(d.tooltipBorder||'1px solid #888').split(' ')[0]}" style="width: 38px; padding: 2px; border: 1px solid #ccc; border-radius: 3px; font-size: 13px;" placeholder="1px">
                                <select id="tooltip-border-style" style="width: 60px; font-size: 13px;">
                                    ${['solid','dashed','dotted','double','groove','ridge','inset','outset','none'].map(style => `<option value='${style}'${(d.tooltipBorder||'1px solid #888').split(' ')[1]===style?' selected':''}>${style}</option>`).join('')}
                                </select>
                                <input type="color" id="tooltip-border-color" value="${(() => {let c=(d.tooltipBorder||'1px solid #888').split(' ')[2];if(!c||!c.startsWith('#'))return'#888888';return c;})()}" style="width: 28px; height: 22px; border: 1px solid #ccc; border-radius: 3px;">
                            </div>
                        </div>
                        <div style="flex: 1 1 0; min-width: 80px;">
                            <label style="display: block; font-size: 12px; margin-bottom: 2px;">Tooltip Border Radius:</label>
                            <input type="text" id="tooltip-radius" value="${d.tooltipRadius || '6px'}" style="width: 60px; padding: 2px; border: 1px solid #ccc; border-radius: 3px; font-size: 13px;" placeholder="6px">
                        </div>
                        <div style="flex: 1 1 0; min-width: 80px;">
                            <label style="display: block; font-size: 12px; margin-bottom: 2px;">Tooltip Font Size:</label>
                            <input type="text" id="tooltip-fontsize" value="${d.tooltipFontSize || '14px'}" style="width: 48px; padding: 2px; border: 1px solid #ccc; border-radius: 3px; font-size: 13px;" placeholder="14px">
                        </div>
                    </div>
                    <p style="margin: 5px 0 0 0; font-size: 11px; color: #666;">
                        Custom hover text and style for this node
                    </p>
                </div>
            `,
        // ...existing code...
            buttons: [
                {
                    action: "update",
                    label: "Apply Changes",
                    callback: (event, button, dialog) => {
                        const hidden = dialog.element.querySelector('#hidden-checkbox')?.checked || false;
                        const customName = dialog.element.querySelector('#custom-name')?.value.trim() || '';
                        const nodeColor = dialog.element.querySelector('#node-color')?.value || '#69b3a2';
                        const nodeShape = dialog.element.querySelector('#node-shape')?.value || 'circle';
                        const nodeSize = parseInt(dialog.element.querySelector('#node-size')?.value) || 30;
                        const customTooltip = dialog.element.querySelector('#custom-tooltip')?.value.trim() || '';
                        const tooltipBg = dialog.element.querySelector('#tooltip-bg')?.value || '#222222';
                        const tooltipColor = dialog.element.querySelector('#tooltip-color')?.value || '#ffffff';
                        // Compose tooltip border from dropdowns
                        const borderWidth = dialog.element.querySelector('#tooltip-border-width')?.value || '1px';
                        const borderStyle = dialog.element.querySelector('#tooltip-border-style')?.value || 'solid';
                        const borderColor = dialog.element.querySelector('#tooltip-border-color')?.value || '#888888';
                        const tooltipBorder = `${borderWidth} ${borderStyle} ${borderColor}`;
                        const tooltipRadius = dialog.element.querySelector('#tooltip-radius')?.value || '6px';
                        const tooltipFontSize = dialog.element.querySelector('#tooltip-fontsize')?.value || '14px';
                        // Apply changes
                        let hasChanges = false;
                        if (d.hiddenFromPlayers !== hidden) {
                            d.hiddenFromPlayers = hidden;
                            hasChanges = true;
                        }
                        if (d.customName !== customName) {
                            d.customName = customName;
                            hasChanges = true;
                        }
                        // For empty nodes, also update the label property and text color
                        if (d.type === 'Empty') {
                            if (d.label !== customName && customName) {
                                d.label = customName;
                                hasChanges = true;
                            }
                            const textColor = dialog.element.querySelector('#empty-text-color')?.value || '#444444';
                            if (d.textColor !== textColor) {
                                d.textColor = textColor;
                                hasChanges = true;
                            }
                            if (d.customTooltip !== customTooltip) {
                                d.customTooltip = customTooltip;
                                hasChanges = true;
                            }
                        } else {
                            // For non-empty nodes, allow changing the image URL
                            const imgUrl = dialog.element.querySelector('#node-img-url')?.value.trim() || '';
                            if (d.img !== imgUrl) {
                                d.img = imgUrl;
                                hasChanges = true;
                            }
                        }
                        if (d.nodeColor !== nodeColor) {
                            d.nodeColor = nodeColor;
                            hasChanges = true;
                        }
                        if (d.nodeShape !== nodeShape) {
                            d.nodeShape = nodeShape;
                            hasChanges = true;
                        }
                        if (d.nodeSize !== nodeSize) {
                            d.nodeSize = nodeSize;
                            hasChanges = true;
                        }
                        if (d.customTooltip !== customTooltip) {
                            d.customTooltip = customTooltip;
                            hasChanges = true;
                        }
                        if (d.tooltipBg !== tooltipBg) {
                            d.tooltipBg = tooltipBg;
                            hasChanges = true;
                        }
                        if (d.tooltipColor !== tooltipColor) {
                            d.tooltipColor = tooltipColor;
                            hasChanges = true;
                        }
                        if (d.tooltipBorder !== tooltipBorder) {
                            d.tooltipBorder = tooltipBorder;
                            hasChanges = true;
                        }
                        if (d.tooltipRadius !== tooltipRadius) {
                            d.tooltipRadius = tooltipRadius;
                            hasChanges = true;
                        }
                        if (d.tooltipFontSize !== tooltipFontSize) {
                            d.tooltipFontSize = tooltipFontSize;
                            hasChanges = true;
                        }
                        if (hasChanges) {
                            this._updateNetwork(); // Preserve zoom when updating node properties
                            this._saveNetworkData();
                            ui.notifications.info(`${d.name} appearance updated`);
                        }
                    }
                },
                {
                    action: "reset",
                    label: "Reset to Default",
                    callback: async () => {
                        const proceed = await this.confirmationDialog(`Reset ${d.name} to default appearance?`);
                        if (proceed) {
                            d.hiddenFromPlayers = false;
                            d.customName = '';
                            d.nodeColor = '#69b3a2';
                            d.nodeShape = 'circle';
                            d.nodeSize = 30;
                            d.customTooltip = '';
                            this._updateNetwork();
                            this._saveNetworkData();
                            ui.notifications.info(`${d.name} reset to default appearance`);
                        }
                    }
                },
                {
                    action: "open",
                    label: `Open ${d.type || 'Document'}`,
                    callback: () => {
                        if (d.canObserve) {
                            this._onOpenDocument(d.uuid, d.type || "Actor");
                        } else {
                            ui.notifications.warn("You don't have permission to view this document.");
                        }
                    }
                },
                {
                    action: "remove", 
                    label: "Remove from Network",
                    callback: async () => {
                        const proceed = await this.confirmationDialog(`Remove ${d.name} from the network?`);
                        if (proceed) {
                            this._removeNode(d);
                        }
                    }
                },
                {
                    action: "cancel",
                    label: "Cancel",
                    callback: () => {}
                }
            ]
        }).render(true);
    }
    _highlightNode(node, highlight) {
        // Highlight the node's shape (circle, rect, polygon)
        const nodeSel = this.nodeElements.filter(d => d === node);
        // For empty nodes, fill red and dark border
        if (highlight && node.type === 'Empty') {
            nodeSel.select('.node')
                .attr('fill', '#ff6b6b')
                .attr('stroke', '#a10000')
                .attr('stroke-width', 5);
        } else {
            nodeSel.select('.node')
                .attr('fill', node.nodeColor || (node.type === 'Empty' ? '#cccccc' : '#fff'))
                .attr('stroke', highlight ? '#ff6b6b' : '#333')
                .attr('stroke-width', highlight ? 4 : 2);
        }

        // For nodes with images, apply a red filter when highlighted
        const img = nodeSel.select('.node-image');
        if (highlight && node.type !== 'Empty') {
            img.style('filter', 'brightness(0.7) sepia(1) hue-rotate(-30deg) saturate(6)');
        } else {
            img.style('filter', null);
        }
    }


    async _toggleLink(nodeA, nodeB) {
        console.log(`Network Widget | Attempting to toggle link between ${nodeA.name} and ${nodeB.name}`);
        console.log(`Network Widget | Current links before toggle:`, this.links.length);
        
        // Check if link already exists
        const existingLinkIndex = this.links.findIndex(link => 
            (link.source === nodeA && link.target === nodeB) ||
            (link.source === nodeB && link.target === nodeA)
        );

        if (existingLinkIndex !== -1) {
            // Remove existing link
            this.links.splice(existingLinkIndex, 1);
            console.log(`Network Widget | Removed link between ${nodeA.name} and ${nodeB.name}`);
            console.log(`Network Widget | Links after removal:`, this.links.length);
            ui.notifications.info(`Removed link between ${nodeA.name} and ${nodeB.name}`);
        } else {
            // Create new link - prompt for relationship type
            const label = await this._promptForLinkLabel(`Enter relationship type between ${nodeA.name} and ${nodeB.name}:`);
            
            if (label !== null) { // User didn't cancel
                this.links.push({
                    source: nodeA,
                    target: nodeB,
                    label: label || 'Connected'
                });
                console.log(`Network Widget | Created link between ${nodeA.name} and ${nodeB.name} with label: ${label}`);
                console.log(`Network Widget | Links after creation:`, this.links.length);
                ui.notifications.info(`Created "${label || 'Connected'}" link between ${nodeA.name} and ${nodeB.name}`);
            } else {
                // User cancelled - don't create link
                console.log(`Network Widget | Link creation cancelled by user`);
                return;
            }
        }

        this._updateNetwork(); // Preserve zoom when toggling links
        console.log(`Network Widget | About to save network data with ${this.links.length} links`);
        await this._saveNetworkData();
        console.log(`Network Widget | Finished saving network data`);
    }

    async _promptForLinkLabel(message) {
        return new Promise((resolve) => {
            new foundry.applications.api.DialogV2({
                window: { title: "Relationship Type" },
                content: `
                    <div style="margin-bottom: 15px;">
                        <p>${message}</p>
                        <input type="text" id="link-label-input" placeholder="e.g., friend, family, ally, enemy..." 
                               style="width: 100%; padding: 8px, 8px, 8px, 0;">
                    </div>
                `,
                buttons: [
                    {
                        action: "confirm",
                        label: "Create Link",
                        callback: (event, button, dialog) => {
                            const input = dialog.element.querySelector('#link-label-input');
                            resolve(input ? input.value.trim() : '');
                        }
                    },
                    {
                        action: "cancel",
                        label: "Cancel",
                        callback: () => resolve(null)
                    }
                ],
                default: "confirm"
            }).render(true);
        });
    }

    async _editLinkLabel(link) {
        const sourceName = link.source.name || link.source.id;
        const targetName = link.target.name || link.target.id;
        const currentLabel = link.label || '';
        
        const newLabel = await new Promise((resolve) => {
            new foundry.applications.api.DialogV2({
                window: { title: "Edit Relationship" },
                content: `
                    <div style="margin-bottom: 15px;">
                        <p>Edit relationship between <strong>${sourceName}</strong> and <strong>${targetName}</strong>:</p>
                        <input type="text" id="edit-link-label-input" value="${currentLabel}" 
                               placeholder="e.g., friend, family, ally, enemy..." 
                               style="width: 100%; padding: 8px, 8px, 8px, 0;">
                    </div>
                `,
                buttons: [
                    {
                        action: "save",
                        label: "Save",
                        callback: (event, button, dialog) => {
                            const input = dialog.element.querySelector('#edit-link-label-input');
                            resolve(input ? input.value.trim() : currentLabel);
                        }
                    },
                    {
                        action: "remove",
                        label: "Remove Link",
                        callback: () => resolve('__REMOVE__')
                    },
                    {
                        action: "cancel",
                        label: "Cancel",
                        callback: () => resolve(null)
                    }
                ],
                default: "save"
            }).render(true);
        });

        if (newLabel === null) {
            // User cancelled
            return;
        } else if (newLabel === '__REMOVE__') {
            // User wants to remove the link
            const linkIndex = this.links.indexOf(link);
            if (linkIndex !== -1) {
                this.links.splice(linkIndex, 1);
                ui.notifications.info(`Removed link between ${sourceName} and ${targetName}`);
                this._updateNetwork(); // Preserve zoom when editing links
                await this._saveNetworkData();
            }
        } else {
            // Update the label
            link.label = newLabel;
            ui.notifications.info(`Updated relationship to "${newLabel}"`);
            this._updateNetwork(); // Preserve zoom when editing links
            await this._saveNetworkData();
        }
    }

    _removeNode(nodeToRemove) {
        // Remove node from nodes array
        this.nodes = this.nodes.filter(node => node.id !== nodeToRemove.id);
        
        // Remove node from nodeMap
        this.nodeMap.delete(nodeToRemove.uuid);
        
        // Remove all links connected to this node
        this.links = this.links.filter(link => 
            link.source !== nodeToRemove && link.target !== nodeToRemove &&
            link.source.id !== nodeToRemove.id && link.target.id !== nodeToRemove.id
        );
        
        // Clear selection if this was the selected node
        if (this.selectedNode === nodeToRemove) {
            this.selectedNode = null;
        }
        
        this._updateNetwork(); // Preserve zoom when removing nodes
        this._saveNetworkData();
        
        ui.notifications.info(`Removed ${nodeToRemove.name} from the network`);
    }

    _toggleLinkingMode() {
        this.linkingMode = !this.linkingMode;
        
        const button = this.container.parentElement.querySelector('.toggle-linking');
        if (button) {
            button.classList.toggle('active', this.linkingMode);
            if (this.linkingMode) {
                button.style.backgroundColor = '#ff6b6b';
                button.style.color = 'white';
            } else {
                button.style.backgroundColor = '';
                button.style.color = '';
            }
        }

        // Clear selection when exiting linking mode
        if (!this.linkingMode && this.selectedNode) {
            this._highlightNode(this.selectedNode, false);
            this.selectedNode = null;
        }

        // Update instructions
        this._updateInstructions();

        // Save the linking mode state and clear selected node if needed
        this.widgetData.linkingMode = this.linkingMode;

        this.widgetData.selectedNodeId = this.linkingMode && this.selectedNode ? this.selectedNode.id : null;
        
        // Save data to persist state
        this._saveNetworkData();

        ui.notifications.info(this.linkingMode ? "Linking mode enabled. Click two nodes to link/unlink them." : "Linking mode disabled.");
    }

    async _clearNetwork() {
        const proceed = await this.confirmationDialog("Are you sure you want to clear all nodes, links from the network?");
        if (!proceed) return;

        this.nodes = [];
        this.links = [];

        this.nodeMap.clear();
        this.selectedNode = null;

        this.linkingMode = false;

        
        const linkButton = this.container?.parentElement?.querySelector('.toggle-linking');
        if (linkButton) {
            linkButton.classList.remove('active');
            linkButton.style.backgroundColor = '';
            linkButton.style.color = '';
        }
        


        this._updateNetwork(false); // Reset zoom when clearing network
        this._updateInstructions();
        
        // Clear all state
        this.widgetData.selectedNodeId = null;
        this.widgetData.linkingMode = false;

        
        await this._saveNetworkData();
        ui.notifications.info("Network cleared.");
    }

    _onDragOver(event) {
        //event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        event.currentTarget.classList.add("drag-over");
    }

    _onDragLeave(event) {
        event.currentTarget.classList.remove("drag-over");
    }

    async _onDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.classList.remove("drag-over");

        // Ignore image file drops (handled by image overlay logic)
        const textData = event.dataTransfer.getData("text/plain");
        if (textData && (textData.endsWith('.png') || textData.endsWith('.jpg') || textData.endsWith('.jpeg') || textData.endsWith('.webp') || textData.endsWith('.svg'))) {
            return;
        }

        let data;
        try {
            data = JSON.parse(textData);
        } catch (err) {
            console.warn("Campaign Codex | Failed to parse drop data.");
            return;
        }

        // If it's a Foundry Tile, treat as floating image
        if (data.type === "Tile" && data.texture && data.texture.src) {
            const rect = this.container.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            this._addFloatingImage(data.texture.src, x, y);
            return;
        }

        // Support multiple document types
        const supportedTypes = ["Actor", "Item", "JournalEntry", "JournalEntryPage", "RollTable", "Scene"];
        if (!supportedTypes.includes(data.type)) {
            ui.notifications.warn(`Only ${supportedTypes.join(", ")} can be dropped onto the network.`);
            return;
        }

        const document = await fromUuid(data.uuid);
        if (!document) {
            ui.notifications.error("Could not find the dropped document.");
            return;
        }

        // Check if document already exists in network
        if (this.nodeMap.has(document.uuid)) {
            ui.notifications.warn(`${document.name} is already in the network.`);
            return;
        }

        // Check user permissions and determine display info
        const canObserve = document.testUserPermission(game.user, CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER);
        
        let displayName, displayImg, displayType;
        
        if (canObserve) {
            displayName = document.name;
            displayType = data.type;
            
            // Get appropriate image based on document type
            switch (data.type) {
                case "Actor":
                    displayImg = document.img || 'icons/svg/mystery-man.svg';
                    break;
                case "Item":
                    displayImg = document.img || 'icons/svg/item-bag.svg';
                    break;
                case "JournalEntry":
                    displayImg = 'icons/sundries/books/book-backed-silver-gold.webp';
                    break;
                case "JournalEntryPage":
                    // For journal pages, try to get parent journal image or use page icon
                    displayImg = document.parent?.img || 'icons/sundries/scrolls/scroll-bound-black-tan.webp';
                    break;
                case "RollTable":
                    displayImg = document.img || 'icons/svg/d20-black.svg';
                    break;
                case "Scene":
                    displayImg = document.thumb || document.background?.src || 'icons/svg/compass.svg';
                    break;
                default:
                    displayImg = 'icons/svg/mystery-man.svg';
            }
        } else {
            // User can't observe - show question mark
            displayName = "Unknown";
            displayType = "Unknown";
            displayImg = 'icons/svg/mystery-man.svg'; // We'll style this as a question mark
        }

        // Get drop position
        const rect = this.container.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;

        // Create new node
        const newNode = {
            id: document.uuid,
            uuid: document.uuid,
            name: displayName,
            img: displayImg,
            type: displayType,
            canObserve: canObserve,
            hiddenFromPlayers: false, // New nodes are visible by default
            customName: '', // No custom name by default
            nodeColor: '#69b3a2', // Default green color
            nodeShape: 'circle', // Default circle shape
            nodeSize: 30, // Default size
            customTooltip: '', // No custom tooltip by default
            x: x,
            y: y
        };

        this.nodes.push(newNode);
        this.nodeMap.set(document.uuid, newNode);

        this._updateNetwork(); // Preserve zoom when adding nodes
        await this._saveNetworkData();
        
        ui.notifications.info(`Added ${displayName} to the network.`);
    }

    async _saveNetworkData() {
        // Store current zoom state before saving (which triggers re-render)
        if (this.zoomContainer) {
            const currentTransform = d3.zoomTransform(this.zoomContainer.node());
            NetworkWidget.storeZoomState(this.widgetId, currentTransform);
        }
        

        const dataToSave = {
            nodes: this.nodes.map(node => {
                // Persist tooltip style fields for all nodes
                const tooltipBg = node.tooltipBg || '#222222';
                const tooltipColor = node.tooltipColor || '#ffffff';
                const tooltipBorder = node.tooltipBorder || '1px solid #888';
                const tooltipRadius = node.tooltipRadius || '6px';
                const tooltipFontSize = node.tooltipFontSize || '14px';
                if (node.type === 'Empty') {
                    return {
                        id: node.id,
                        uuid: node.uuid,
                        name: node.name,
                        img: '',
                        type: 'Empty',
                        nodeColor: node.nodeColor || '#cccccc',
                        nodeShape: node.nodeShape || 'circle',
                        nodeSize: node.nodeSize || 30,
                        x: node.x,
                        y: node.y,
                        label: node.label || node.name,
                        textColor: node.textColor || '#444444',
                        customTooltip: node.customTooltip || '',
                        tooltipBg,
                        tooltipColor,
                        tooltipBorder,
                        tooltipRadius,
                        tooltipFontSize
                    };
                } else {
                    return {
                        id: node.id,
                        uuid: node.uuid,
                        name: node.name,
                        img: node.img,
                        type: node.type || 'Actor',
                        canObserve: node.canObserve !== false,
                        hiddenFromPlayers: node.hiddenFromPlayers || false,
                        customName: node.customName || '',
                        nodeColor: node.nodeColor || '#69b3a2',
                        nodeShape: node.nodeShape || 'circle',
                        nodeSize: node.nodeSize || 30,
                        customTooltip: node.customTooltip || '',
                        x: node.x,
                        y: node.y,
                        tooltipBg,
                        tooltipColor,
                        tooltipBorder,
                        tooltipRadius,
                        tooltipFontSize
                    };
                }
            }),
            links: this.links.map(link => ({
                source: typeof link.source === 'object' ? link.source.id : link.source,
                target: typeof link.target === 'object' ? link.target.id : link.target,
                label: link.label || ''
            })),
            floatingImages: this.floatingImages.map(img => ({ ...img })),
            linkingMode: this.linkingMode || false,
            selectedNodeId: this.selectedNode ? this.selectedNode.id : null,
            nodesLocked: this.nodesLocked || false
        };

        console.log('Network Widget | Saving data:', JSON.stringify(dataToSave, null, 2));
        console.log('Network Widget | Links array being saved:', this.links);

        
        this.widgetData = dataToSave;
        await this.saveData(this.widgetData);
        
        console.log('Network Widget | Data saved successfully');
    }

    // Helper methods for node visibility and styling
    _shouldShowNodeContent(node) {
        // GMs can always see content if they have permission
        // Players cannot see content if node is hidden from them or they lack permission
        if (this.isGM) {
            return node.canObserve; // GM shows content if they have permission (hidden nodes get red aura)
        } else {
            return node.canObserve && !node.hiddenFromPlayers; // Players need both permission and not hidden
        }
    }

    _getNodeDisplayName(node) {
        if (this.isGM) {
            return node.customName || node.name; // GMs see custom name or real name
        } else {
            if (node.hiddenFromPlayers) {
                return "?????"; // Hidden from players
            } else if (!node.canObserve) {
                return "Unknown"; // No permission
            } else {
                return node.customName || node.name; // Normal display (custom or real name)
            }
        }
    }

    _getNodeTooltip(node) {
        if (node.customTooltip) {
            return node.customTooltip; // Use custom tooltip if set
        }
        return this._getNodeDisplayName(node); // Fall back to display name
    }

    _getNodeFillColor(node) {
        if (!this._shouldShowNodeContent(node)) {
            return "#000000"; // Black for hidden/unknown nodes to players
        } else {
            return node.nodeColor || "#69b3a2"; // Use custom color or default green
        }
    }

    _getNodeStrokeColor(node) {
        if (this.isGM && node.hiddenFromPlayers) {
            return "#ff0000"; // Red aura for hidden nodes (GM view)
        } else {
            return "#333"; // Normal stroke
        }
    }

    _getNodeStrokeWidth(node) {
        if (this.isGM && node.hiddenFromPlayers) {
            return 4; // Thicker red border for hidden nodes (GM view)
        } else {
            return 2; // Normal stroke width
        }
    }

    _getQuestionMarkText(node) {
        if (!this.isGM && node.hiddenFromPlayers) {
            return "?????"; // 5 question marks for hidden nodes (player view)
        } else {
            return "?"; // Single question mark for no permission
        }
    }

    _getQuestionMarkBgColor(node) {
        if (!this.isGM && node.hiddenFromPlayers) {
            return "#000000"; // Black background for hidden nodes (player view)
        } else {
            return "#666"; // Gray background for no permission
        }
    }

    _getQuestionMarkFontSize(node, nodeSize = null) {
        const size = nodeSize || node.nodeSize || 30;
        if (!this.isGM && node.hiddenFromPlayers) {
            return `${Math.max(12, size * 0.6)}px`; // Smaller font for 5 question marks, scaled to node size
        } else {
            return `${Math.max(16, size * 0.8)}px`; // Larger font for single question mark, scaled to node size
        }
    }

    _toggleFullscreen() {
        if (this.isFullscreen) {
            this._exitFullscreen();
        } else {
            this._enterFullscreen();
        }
    }

    _enterFullscreen() {
        this.isFullscreen = true;
        
        // Store current transform before going fullscreen
        if (this.zoomContainer) {
            const currentTransform = d3.zoomTransform(this.zoomContainer.node());
            NetworkWidget.storeZoomState(this.widgetId, currentTransform);
        }
        
        // Create fullscreen overlay
        this.fullscreenOverlay = document.createElement('div');
        this.fullscreenOverlay.className = 'network-widget-fullscreen-overlay';
        this.fullscreenOverlay.innerHTML = `
            <div class="fullscreen-header">
                <h2>Network Map - Fullscreen Mode</h2>
                <div class="fullscreen-controls">
                    <button type="button" class="fullscreen-reset-zoom" title="Reset zoom to fit all nodes">
                        <i class="fas fa-search"></i> Reset Zoom
                    </button>
                    <button type="button" class="fullscreen-exit" title="Exit fullscreen (ESC)">
                        <i class="fas fa-compress"></i> Exit Fullscreen
                    </button>
                </div>
            </div>
            <div class="fullscreen-network-container"></div>
        `;
        
        document.body.appendChild(this.fullscreenOverlay);
        
        // Move the SVG to the fullscreen container
        const fullscreenContainer = this.fullscreenOverlay.querySelector('.fullscreen-network-container');
        const svg = this.svg.node();
        fullscreenContainer.appendChild(svg);
        
        // Update dimensions to fullscreen
        const newWidth = window.innerWidth - 40; // 20px padding each side
        const newHeight = window.innerHeight - 100; // Leave space for header
        this.width = newWidth;
        this.height = newHeight;
        
        this.svg
            .attr('width', this.width)
            .attr('height', this.height);
        
        // Update force simulation center
        if (this.simulation) {
            this.simulation.force('center', d3.forceCenter(this.width / 2, this.height / 2));
            this.simulation.alpha(0.1).restart();
        }
        
        // Restore zoom transform
        const savedZoomState = NetworkWidget.getZoomState(this.widgetId);
        if (savedZoomState && this.svg) {
            this.svg.call(this.zoom.transform, savedZoomState);
        }
        
        // Add event listeners
        this.fullscreenOverlay.querySelector('.fullscreen-exit').addEventListener('click', () => this._exitFullscreen());
        this.fullscreenOverlay.querySelector('.fullscreen-reset-zoom').addEventListener('click', () => this._resetZoom());
        
        // ESC key handler
        this._fullscreenEscHandler = (e) => {
            if (e.key === 'Escape') {
                this._exitFullscreen();
            }
        };
        document.addEventListener('keydown', this._fullscreenEscHandler);
        
        // Update button icon in original controls
        const toggleBtn = this.container?.parentElement?.querySelector('.toggle-fullscreen');
        if (toggleBtn) {
            toggleBtn.innerHTML = '<i class="fas fa-compress"></i> Exit Fullscreen';
        }
    }

    _exitFullscreen() {
        if (!this.isFullscreen || !this.fullscreenOverlay) return;
        
        this.isFullscreen = false;
        
        // Store current transform before exiting
        if (this.zoomContainer) {
            const currentTransform = d3.zoomTransform(this.zoomContainer.node());
            NetworkWidget.storeZoomState(this.widgetId, currentTransform);
        }
        
        // Move SVG back to original container
        const svg = this.svg.node();
        this.container.appendChild(svg);
        
        // Restore original dimensions
        const containerRect = this.container.getBoundingClientRect();
        this.width = containerRect.width || 800;
        this.height = 600;
        
        this.svg
            .attr('width', this.width)
            .attr('height', this.height);
        
        // Update force simulation center
        if (this.simulation) {
            this.simulation.force('center', d3.forceCenter(this.width / 2, this.height / 2));
            this.simulation.alpha(0.1).restart();
        }
        
        // Restore zoom transform
        const savedZoomState = NetworkWidget.getZoomState(this.widgetId);
        if (savedZoomState && this.svg) {
            this.svg.call(this.zoom.transform, savedZoomState);
        }
        
        // Remove fullscreen overlay
        if (this.fullscreenOverlay.parentNode) {
            this.fullscreenOverlay.parentNode.removeChild(this.fullscreenOverlay);
        }
        this.fullscreenOverlay = null;
        
        // Remove ESC key handler
        if (this._fullscreenEscHandler) {
            document.removeEventListener('keydown', this._fullscreenEscHandler);
            this._fullscreenEscHandler = null;
        }
        
        // Update button icon in original controls
        const toggleBtn = this.container?.parentElement?.querySelector('.toggle-fullscreen');
        if (toggleBtn) {
            toggleBtn.innerHTML = '<i class="fas fa-expand"></i> Fullscreen';
        }
    }

    _exportNetwork() {
        // Collect all network data
        const exportData = {
            version: '1.0',
            timestamp: new Date().toISOString(),
            nodes: this.nodes,
            links: this.links,
            floatingImages: this.floatingImages
        };
        
        // Convert to JSON string
        const jsonString = JSON.stringify(exportData, null, 2);
        
        // Copy to clipboard
        navigator.clipboard.writeText(jsonString).then(() => {
            ui.notifications.info('Network map copied to clipboard!');
        }).catch(err => {
            console.error('Network Widget | Clipboard error:', err);
            ui.notifications.error('Failed to copy to clipboard');
        });
    }

    _importNetwork() {
        // Try to read from clipboard
        navigator.clipboard.readText().then(clipboardText => {
            try {
                const importedData = JSON.parse(clipboardText);
                
                // Validate imported data
                if (!importedData.nodes || !Array.isArray(importedData.nodes)) {
                    throw new Error('Invalid network map format: missing nodes array');
                }
                
                // Show confirmation dialog
                new Dialog({
                    title: 'Import Network Map',
                    content: `
                        <p>This will <strong>replace</strong> your current network map with the imported data.</p>
                        <p style="margin-top: 10px; color: #666;">Imported data:</p>
                        <ul style="margin: 8px 0; padding-left: 20px; font-size: 12px;">
                            <li>${importedData.nodes?.length || 0} nodes</li>
                            <li>${importedData.links?.length || 0} links</li>
                            <li>${importedData.floatingImages?.length || 0} floating images</li>
                        </ul>
                        <p style="margin-top: 10px; color: #c00; font-weight: bold;">This action cannot be undone!</p>
                    `,
                    buttons: {
                        import: {
                            label: 'Import',
                            callback: () => this._performImport(importedData)
                        },
                        cancel: {
                            label: 'Cancel'
                        }
                    },
                    default: 'cancel'
                }).render(true);
            } catch (error) {
                console.error('Network Widget | Import error:', error);
                ui.notifications.error(`Failed to import network map: ${error.message}`);
            }
        }).catch(err => {
            console.error('Network Widget | Clipboard error:', err);
            ui.notifications.error('Failed to read from clipboard. Make sure you have copied a network map first!');
        });
    }

    _performImport(importedData) {
        try {
            // Restore nodes
            this.nodes = (importedData.nodes || []).map(nodeData => ({
                ...nodeData,
                x: nodeData.x || Math.random() * this.width,
                y: nodeData.y || Math.random() * this.height
            }));
            
            // Restore links
            this.links = importedData.links || [];
            

            
            // Restore floating images
            this.floatingImages = (importedData.floatingImages || []).map(img => ({
                id: img.id,
                href: img.href,
                x: img.x,
                y: img.y,
                width: img.width,
                height: img.height,
                filter: img.filter || '',
                animation: img.animation || '',
                linkedUuid: img.linkedUuid || '',
                rotation: img.rotation || 0,
                opacity: img.opacity !== undefined ? img.opacity : 100,
                zIndex: img.zIndex || 0,
                locked: img.locked || false,
                borderColor: img.borderColor || '#000000',
                borderWidth: img.borderWidth || 0,
                borderStyle: img.borderStyle || 'solid',
                shadowEnabled: img.shadowEnabled !== undefined ? img.shadowEnabled : false,
                shadowColor: img.shadowColor || '#000000',
                shadowBlur: img.shadowBlur !== undefined ? img.shadowBlur : 5,
                shadowOffsetX: img.shadowOffsetX !== undefined ? img.shadowOffsetX : 3,
                shadowOffsetY: img.shadowOffsetY !== undefined ? img.shadowOffsetY : 3
            }));
            
            // Update node map
            this.nodeMap.clear();
            this.nodes.forEach(node => {
                this.nodeMap.set(node.uuid, node);
            });
            
            // Update widget data
            this.widgetData = {
                nodes: this.nodes,
                links: this.links,

                floatingImages: this.floatingImages,
                linkingMode: this.linkingMode,

                selectedNodeId: this.selectedNode?.id || null
            };
            
            // Refresh display
            this._updateNetwork();
            this._saveNetworkData();
            
            ui.notifications.info('Network map imported successfully');
        } catch (error) {
            console.error('Network Widget | Import error:', error);
            ui.notifications.error(`Failed to import network map: ${error.message}`);
        }
    }
_updateLockNodesButton(lockBtn) {
    if (!lockBtn) return;
    const label = lockBtn.querySelector('.lock-nodes-label');
    const icon = lockBtn.querySelector('i');
    if (this.nodesLocked) {
        lockBtn.classList.add('active');
        lockBtn.style.backgroundColor = '#ff6b6b';
        lockBtn.style.color = 'white';
        if (label) label.textContent = 'Locked';
        if (icon) icon.className = 'fas fa-lock';
    } else {
        lockBtn.classList.remove('active');
        lockBtn.style.backgroundColor = '';
        lockBtn.style.color = '';
        if (label) label.textContent = 'Lock';
        if (icon) icon.className = 'fas fa-lock-open';
    }
}
    _getImageFilter(d) {
        // Build a combined filter string with shadow and regular filters
        let filters = [];
        
        // Add shadow filter if enabled
        if (d.shadowEnabled) {
            // Create a drop shadow effect: blur + offset + color
            const blur = Math.max(0, d.shadowBlur || 5);
            const offsetX = d.shadowOffsetX || 3;
            const offsetY = d.shadowOffsetY || 3;
            const color = d.shadowColor || '#000000';
            
            // Convert hex to rgba for the shadow with default 40% opacity
            const shadowFilter = `drop-shadow(${offsetX}px ${offsetY}px ${blur}px ${color})`;
            filters.push(shadowFilter);
        }
        
        // Add regular filter if set
        if (d.filter) {
            filters.push(d.filter);
        }
        
        return filters.length > 0 ? filters.join(' ') : null;
    }

    async close() {
        // Exit fullscreen if active
        if (this.isFullscreen) {
            this._exitFullscreen();
        }
        
        // Clean up zoom state
        if (NetworkWidget._zoomStates) {
            NetworkWidget._zoomStates.delete(this.widgetId);
        }
        
        if (this.simulation) {
            this.simulation.stop();
            this.simulation = null;
        }
        await super.close();
    }
}
return NetworkWidget;
}
