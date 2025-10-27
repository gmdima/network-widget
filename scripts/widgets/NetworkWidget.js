export function createNetworkWidget(CampaignCodexWidget) {

class NetworkWidget extends CampaignCodexWidget {
    constructor(widgetId, initialData, document) {
        super(widgetId, initialData, document);
        this.svg = null;
        this.simulation = null;
        this.nodes = [];
        this.links = [];
        this.annotations = []; // Add annotations array
        this.nodeElements = null;
        this.linkElements = null;
        this.annotationElements = null; // Add annotation elements
        this.nodeMap = new Map(); // Store actor UUID to node mapping
        this.linkingMode = false;
        this.annotationMode = false; // Add annotation mode
        this.selectedNode = null;
        this.selectedAnnotation = null; // Add selected annotation
        this.widgetData = null;
        this.container = null;
        this.width = 800;
        this.height = 600;
        
        // Add static zoom state storage
        NetworkWidget._zoomStates = NetworkWidget._zoomStates || new Map();

        this.floatingImages = [];
        this.selectedFloatingImageId = null;
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
            <div class="cc-widget network-widget">
                <div class="network-controls">
                    ${this.isGM ? `
                        <button type="button" class="toggle-linking" title="Toggle linking mode">
                            <i class="fas fa-link"></i> Link Mode
                        </button>
                        <button type="button" class="add-empty-node" title="Add an empty node">
                            <i class="fas fa-circle"></i> Add Empty Node
                        </button>
                        <button type="button" class="clear-network" title="Clear all nodes and links">
                            <i class="fas fa-trash"></i> Clear All
                        </button>
                    ` : ''}
                    <button type="button" class="reset-zoom" title="Reset zoom to fit all nodes">
                        <i class="fas fa-search"></i> Reset Zoom
                    </button>
                </div>
                <div id="network-${this.widgetId}" class="network-container"></div>
                <div class="network-instructions">
                    ${this.isGM ? 
                        'Drag actors, items, journals, scenes, or roll tables from the sidebar to add them to the network. Click "Link Mode" and click two nodes to create/remove links. Click "Add Empty Node" to add a label-only node. Click "Create Annotation" to add text annotations. Click "Annotation Arrange" to move existing annotations. Click link labels to edit relationship types. Use mouse wheel to zoom.' :
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
        
        this.widgetData = savedData || { nodes: [], links: [], annotations: [], linkingMode: false, annotationMode: false, selectedNodeId: null };
        console.log('Network Widget | Final widgetData after fallback:', this.widgetData);
        
        // Restore linking mode state
        this.linkingMode = this.widgetData.linkingMode || false;
        this.annotationMode = this.widgetData.annotationMode || false;
        
        // Set up container
        this.container = htmlElement.querySelector(`#network-${this.widgetId}`);
        if (!this.container) {
            console.error(`Campaign Codex | Network container not found for widget ${this.widgetId}`);
            return;
        }

        // Load D3.js if not already loaded
        try {
            await this._loadD3();
            await this._loadD3Annotation();
        } catch (error) {
            console.error('Campaign Codex | Failed to load D3.js or d3-annotation:', error);
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

            const annotationButton = htmlElement.querySelector('.toggle-annotation');
            annotationButton?.addEventListener('click', this._toggleAnnotationMode.bind(this));

            const createAnnotationButton = htmlElement.querySelector('.create-annotation');
            createAnnotationButton?.addEventListener('click', this._onCreateAnnotationClick.bind(this));

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

            if (this.annotationMode && annotationButton) {
                annotationButton.classList.add('active');
                annotationButton.style.backgroundColor = '#28a745';
                annotationButton.style.color = 'white';
            }

            htmlElement.querySelector('.clear-network')?.addEventListener('click', this._clearNetwork.bind(this));

            // Set up drag and drop
            this.container.addEventListener('drop', this._onDrop.bind(this));
            this.container.addEventListener('dragover', this._onDragOver.bind(this));
            this.container.addEventListener('dragleave', this._onDragLeave.bind(this));
        }
        
        // Reset zoom is available for everyone
        htmlElement.querySelector('.reset-zoom')?.addEventListener('click', this._resetZoom.bind(this));
        
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
            });
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
        this._saveNetworkData();
    }

    _addResizeHandles(group, d) {
        const handleSize = 10;
        const corners = [
            { x: d.x, y: d.y },
            { x: d.x + d.width, y: d.y },
            { x: d.x + d.width, y: d.y + d.height },
            { x: d.x, y: d.y + d.height }
        ];
        group.selectAll('.resize-handle').data(corners).enter()
            .append('rect')
            .attr('class', 'resize-handle')
            .attr('x', c => c.x - handleSize/2)
            .attr('y', c => c.y - handleSize/2)
            .attr('width', handleSize)
            .attr('height', handleSize)
            .attr('fill', '#fff')
            .attr('stroke', '#333')
            .attr('stroke-width', 2)
            .style('cursor', (c, i) => ['nwse-resize','nesw-resize','nwse-resize','nesw-resize'][i])
            .call(d3.drag()
                .on('drag', (event, c, i) => this._onResizeHandleDrag(event, d, i))
                .on('end', () => this._saveNetworkData())
            );
    }

    _onResizeHandleDrag(event, d, handleIndex) {
        const minSize = 20;
        let { x, y, width, height } = d;
        switch (handleIndex) {
            case 0: // top-left
                width += x - (x + event.dx);
                height += y - (y + event.dy);
                x += event.dx;
                y += event.dy;
                break;
            case 1: // top-right
                width += event.dx;
                height += y - (y + event.dy);
                y += event.dy;
                break;
            case 2: // bottom-right
                width += event.dx;
                height += event.dy;
                break;
            case 3: // bottom-left
                width += x - (x + event.dx);
                height += event.dy;
                x += event.dx;
                break;
        }
    d.x = x;
    d.y = y;
    d.width = Math.max(minSize, width);
    d.height = Math.max(minSize, height);
    this._updateNetwork(false);
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
    let dialogRendered = null;
    new Dialog({
        title: 'Edit Image Overlay',
        content: `
            <form>
                <div style="margin-bottom:8px;">
                    <label>Width: <input type="number" id="img-width" value="${widthValue}" min="20" style="width:60px;"></label>
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
                    d.filter = html.find('#img-filter').val();
                    d.animation = html.find('#img-animation').val();
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
            if (this.annotationMode) {
                instructions.textContent = 'Annotation Arrange Mode: Click annotations to edit. Drag annotations to reposition. Right-click to delete.';
                instructions.style.fontWeight = 'bold';
                instructions.style.color = '#28a745';
            } else if (this.linkingMode) {
                instructions.textContent = 'Linking Mode: Click two nodes to create/remove links between them. Use mouse wheel to zoom.';
                instructions.style.fontWeight = 'bold';
                instructions.style.color = '#ff6b6b';
            } else {
                instructions.textContent = this.isGM ? 
                    'Drag actors, items, journals, scenes, or roll tables from the sidebar to add them to the network. Click "Link Mode" and click two nodes to create/remove links. Click "Create Annotation" to add text annotations. Click "Annotation Arrange" to move existing annotations. Click link labels to edit relationship types. Use mouse wheel to zoom.' :
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

    async _loadD3Annotation() {
        // Check if d3-annotation is already loaded
        if (typeof d3 !== 'undefined' && d3.annotation) {
            return;
        }

        // Load d3-annotation from CDN (more reliable than local file)
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/d3-svg-annotation@2.5.1/d3-annotation.min.js';
            script.onload = () => {
                // Double-check that d3.annotation is actually available
                if (typeof d3 !== 'undefined' && d3.annotation) {
                    console.log('Campaign Codex | d3-annotation loaded successfully from CDN');
                    resolve();
                } else {
                    console.error('Campaign Codex | d3-annotation script loaded but d3.annotation not available');
                    reject(new Error('d3-annotation not available after loading'));
                }
            };
            script.onerror = () => {
                console.error('Campaign Codex | Failed to load d3-annotation from CDN');
                reject(new Error('Failed to load d3-annotation'));
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
         .style("background", (typeof game !== 'undefined' && game.settings) ? game.settings.get('network-widget', 'backgroundColor') : '#f9f9f9');

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

        // Create groups for links, nodes, and annotations within the zoom container
        this.zoomContainer.append("g").attr("class", "links");
        this.zoomContainer.append("g").attr("class", "nodes");
        this.zoomContainer.append("g").attr("class", "annotations");
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
                    customTooltip: '',
                    x: nodeData.x || Math.random() * this.width,
                    y: nodeData.y || Math.random() * this.height,
                    label: nodeData.label || nodeData.name,
                    textColor: nodeData.textColor || '#444444'
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
                    customTooltip: nodeData.customTooltip || '',
                    x: nodeData.x || Math.random() * this.width,
                    y: nodeData.y || Math.random() * this.height
                };
            }
        });

        // Load links with safety check
        this.links = (this.widgetData.links || []).map(linkData => ({
            source: linkData.source,
            target: linkData.target,
            label: linkData.label || ''
        }));

        // Load annotations
        this.annotations = (this.widgetData.annotations || []).map(annotationData => ({
            id: annotationData.id || `annotation-${Date.now()}-${Math.random()}`,
            x: annotationData.x || 0,
            y: annotationData.y || 0,
            dx: annotationData.dx || 0,
            dy: annotationData.dy || 0,
            note: {
                title: annotationData.title || '',
                label: annotationData.label || ''
            },
            type: d3.annotationLabel
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
            linkedUuid: img.linkedUuid || ''
        }));
        console.log('Network Widget | Loaded floatingImages:', this.floatingImages);

        console.log(`Network Widget | Loaded ${this.nodes.length} nodes, ${this.links.length} links, and ${this.annotations.length} annotations for ${this.isGM ? 'GM' : 'Player'}`);
        console.log('Network Widget | Links data:', this.links);
        console.log('Network Widget | Annotations data:', this.annotations);

        // Update node map
        this.nodeMap.clear();
        this.nodes.forEach(node => {
            this.nodeMap.set(node.uuid, node);
        });

        this._updateNetwork(false); // Allow initial zoom setup
    }

    _updateNetwork(preserveZoom = true) {
        console.log(`Network Widget | Updating network with ${this.nodes.length} nodes and ${this.links.length} links`);
        
        // Store current transform if preserving zoom
        let currentTransform = null;
        if (preserveZoom && this.zoomContainer) {
            currentTransform = d3.zoomTransform(this.zoomContainer.node());
        }
        

        // Get user settings for colors
        let linkColor = '#666';
        let nodeLabelColor = '#333';
        let linkLabelOutlineColor = '#fff';
        if (typeof game !== 'undefined' && game.settings) {
            try { linkColor = game.settings.get('network-widget', 'linkColor') || '#666'; } catch {}
            try { nodeLabelColor = game.settings.get('network-widget', 'nodeLabelColor') || '#333'; } catch {}
            try { linkLabelOutlineColor = game.settings.get('network-widget', 'linkLabelOutlineColor') || '#fff'; } catch {}
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

        console.log(`Network Widget | Rendered ${this.linkElements.size()} link elements`);

        // Update nodes
        this.nodeElements = this.zoomContainer.select(".nodes")
            .selectAll("g")
            .data(this.nodes);

        const nodeEnter = this.nodeElements.enter()
            .append("g")
            .attr("class", "node-group");

        // Only add drag behavior for GMs
        if (this.isGM) {
            nodeEnter.call(d3.drag()
                .on("start", this._dragstarted.bind(this))
                .on("drag", this._dragged.bind(this))
                .on("end", this._dragended.bind(this)));
        }

        // Add tooltip
        nodeEnter.append("title")
            .text(d => this._getNodeTooltip(d));

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

            // Unique clipPath id per node (by id and shape)
            const clipId = `node-clip-${d.id || i}-${shape}`;
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

        this.nodeElements.selectAll('title')
            .text(d => this._getNodeTooltip(d));

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
        let images = floatingImagesGroup.selectAll('.floating-image').data(this.floatingImages, d => d.id);
        const imagesEnter = images.enter().append('g')
            .attr('class', 'floating-image')
            .attr('transform', d => `translate(${d.x},${d.y})`);
        if (this.isGM) {
            imagesEnter
                .call(d3.drag()
                    .on('start', (event, d) => this._onFloatingImageDragStart(event, d))
                    .on('drag', (event, d) => this._onFloatingImageDrag(event, d))
                    .on('end', (event, d) => this._onFloatingImageDragEnd(event, d))
                )
                .on('click', (event, d) => this._onFloatingImageClick(event, d))
                .on('contextmenu', (event, d) => this._onFloatingImageContextMenu(event, d));
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
        imagesEnter.append('image')
            .attr('xlink:href', d => d.href)
            .attr('href', d => d.href)
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', d => d.width)
            .attr('height', d => d.height)
            .attr('class', d => d.animation ? `floating-img-anim-${d.animation}` : null)
            .style('pointer-events', 'all')
            .style('filter', d => d.filter || null);
        // Add resize handles if selected
        imagesEnter.each((d, i, nodes) => {
            if (this.selectedFloatingImageId === d.id) {
                this._addResizeHandles(d3.select(nodes[i]), d);
            }
        });
        // Always update filter and animation class on update selection
        images.select('image')
            .attr('x', 0)
            .attr('y', 0)
            .attr('width', d => d.width)
            .attr('height', d => d.height)
            .attr('class', d => d.animation ? `floating-img-anim-${d.animation}` : null)
            .style('pointer-events', 'all')
            .style('filter', d => d.filter || null);
        // Update group position on update
        images.attr('transform', d => `translate(${d.x},${d.y})`);
        images.exit().remove();

        // Update annotations
        this._updateAnnotations();

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

    _updateAnnotations() {
        if (!d3 || !d3.annotation) {
            console.warn('Campaign Codex | d3-annotation not loaded, skipping annotation update');
            // Try to reload the library
            this._loadD3Annotation().then(() => {
                console.log('Campaign Codex | d3-annotation reloaded, updating annotations');
                this._updateAnnotations();
            }).catch(err => {
                console.error('Campaign Codex | Failed to reload d3-annotation:', err);
                ui.notifications.error('Failed to load annotation library. Annotations may not display correctly.');
            });
            return;
        }

        console.log(`Network Widget | Updating ${this.annotations.length} annotations`);

        try {
            // Create annotation generator - disable edit mode to prevent conflicts
            const makeAnnotations = d3.annotation()
                .editMode(false) // We'll handle our own dragging
                .type(d3.annotationLabel) // Use label type instead of callout to remove connector lines
                .annotations(this.annotations);

            // Remove existing annotations
            this.zoomContainer.select(".annotations").selectAll("*").remove();

            // Add annotations to the annotations group
            this.annotationElements = this.zoomContainer.select(".annotations");
            this.annotationElements.call(makeAnnotations);

            // Add custom interaction handlers for GM
            if (this.isGM) {
                this._setupAnnotationInteractions();
            }

            console.log(`Network Widget | Successfully updated ${this.annotations.length} annotations`);
        } catch (error) {
            console.error('Campaign Codex | Error updating annotations:', error);
            ui.notifications.error('Error displaying annotations. Please try refreshing the page.');
        }
    }

    _setupAnnotationInteractions() {
        // Remove existing event handlers first
        this.annotationElements.selectAll('.annotation')
            .on('click', null)
            .on('contextmenu', null)
            .call(d3.drag().on('start', null).on('drag', null).on('end', null));

        // Add custom interaction handlers to annotations
        this.annotationElements.selectAll('.annotation')
            .each((d, i, nodes) => {
                const annotationGroup = d3.select(nodes[i]);
                
                // Make entire annotation draggable in annotation mode
                if (this.annotationMode) {
                    annotationGroup
                        .classed('draggable', true)
                        .call(d3.drag()
                            .on('start', (event) => this._annotationDragStart(event, d))
                            .on('drag', (event) => this._annotationDrag(event, d))
                            .on('end', (event) => this._annotationDragEnd(event, d))
                        );
                } else {
                    annotationGroup.classed('draggable', false);
                }

                // Add click handler for editing (only in annotation mode)
                if (this.annotationMode) {
                    annotationGroup.on('click', (event) => {
                        event.stopPropagation();
                        this._editAnnotation(d, i);
                    });
                }

                // Add right-click handler for deletion (only for GM)
                if (this.isGM) {
                    annotationGroup.on('contextmenu', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        this._onAnnotationRightClick(d, i);
                    });
                }
            });
    }

    _onAnnotationRightClick(annotation, index) {
        if (!this.isGM) return;

        // Show context menu for annotation actions
        new foundry.applications.api.DialogV2({
            window: { title: `Annotation Actions` },
            content: `<p>Choose an action for this annotation:</p>`,
            buttons: [
                {
                    action: "edit",
                    label: "Edit",
                    callback: () => {
                        this._editAnnotation(annotation, index);
                    }
                },
                {
                    action: "delete", 
                    label: "Delete",
                    callback: async () => {
                        const proceed = await this._confirmDeleteAnnotation(annotation);
                        if (proceed) {
                            this._deleteAnnotation(annotation, index);
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

    async _confirmDeleteAnnotation(annotation) {
        const title = annotation.note.title || 'Untitled';
        const label = annotation.note.label || '';
        const preview = title + (label ? ` - ${label.substring(0, 30)}${label.length > 30 ? '...' : ''}` : '');
        
        return new Promise((resolve) => {
            new foundry.applications.api.DialogV2({
                window: { title: "Delete Annotation" },
                content: `<p>Are you sure you want to delete this annotation?</p><p><strong>"${preview}"</strong></p>`,
                buttons: [
                    {
                        action: "delete",
                        label: "Delete",
                        callback: () => resolve(true)
                    },
                    {
                        action: "cancel",
                        label: "Cancel",
                        callback: () => resolve(false)
                    }
                ],
                default: "cancel"
            }).render(true);
        });
    }

    _deleteAnnotation(annotation, index) {
        // Remove annotation from array
        this.annotations.splice(index, 1);
        
        // Update display
        this._updateAnnotations();
        
        // Save data
        this._saveNetworkData();
        
        ui.notifications.info("Annotation deleted");
    }

    _annotationDragStart(event, annotation) {
        // Store initial position
        annotation._dragStartX = annotation.x;
        annotation._dragStartY = annotation.y;
        
        // Don't try to set cursor style - it causes errors
        // Visual feedback is handled by CSS hover states
    }

    _annotationDrag(event, annotation) {
        // Update annotation position
        annotation.x = event.x;
        annotation.y = event.y;
        
        // Re-render this specific annotation
        this._rerenderSingleAnnotation(annotation);
        
        // Update the position in the annotations array to keep it in sync
        const annotationIndex = this.annotations.findIndex(a => a.id === annotation.id);
        if (annotationIndex !== -1) {
            this.annotations[annotationIndex].x = event.x;
            this.annotations[annotationIndex].y = event.y;
        }
    }

    _annotationDragEnd(event, annotation) {
        // Don't try to set cursor style - it causes errors
        // The cursor will reset automatically when drag ends
        
        // Save data immediately
        this._saveNetworkData();
    }

    _rerenderSingleAnnotation(annotation) {
        // Find the annotation element and update its transform
        this.annotationElements.selectAll('.annotation')
            .filter(d => d.id === annotation.id)
            .attr('transform', `translate(${annotation.x}, ${annotation.y})`);
    }

    _updateAnnotationLinks() {
        // Links removed per user request - annotations no longer connect to nodes visually
    }

    _onAnnotationClick(annotation, index) {
        if (!this.isGM) return;

        console.log('Annotation clicked:', annotation);

        // Edit annotation when clicked
        this._editAnnotation(annotation, index);
    }

    async _editAnnotation(annotation, index) {
        const currentTitle = annotation.note.title || '';
        const currentLabel = annotation.note.label || '';
        
        const result = await new Promise((resolve) => {
            new foundry.applications.api.DialogV2({
                window: { title: "Edit Annotation" },
                content: `
                    <div style="margin-bottom: 15px;">
                        <label for="annotation-title" style="display: block; margin-bottom: 5px; font-weight: bold;">Title:</label>
                        <input type="text" id="annotation-title" value="${currentTitle}" 
                               placeholder="Annotation title..." 
                               style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; margin-bottom: 10px;">
                        <label for="annotation-label" style="display: block; margin-bottom: 5px; font-weight: bold;">Description:</label>
                        <textarea id="annotation-label" 
                                  placeholder="Annotation description..." 
                                  style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; min-height: 60px;">${currentLabel}</textarea>
                    </div>
                `,
                buttons: [
                    {
                        action: "save",
                        label: "Save",
                        callback: (event, button, dialog) => {
                            const titleInput = dialog.element.querySelector('#annotation-title');
                            const labelInput = dialog.element.querySelector('#annotation-label');
                            resolve({
                                action: 'save',
                                title: titleInput ? titleInput.value.trim() : currentTitle,
                                label: labelInput ? labelInput.value.trim() : currentLabel
                            });
                        }
                    },
                    {
                        action: "remove",
                        label: "Remove",
                        callback: () => resolve({ action: 'remove' })
                    },
                    {
                        action: "cancel",
                        label: "Cancel",
                        callback: () => resolve({ action: 'cancel' })
                    }
                ],
                default: "save"
            }).render(true);
        });

        if (result.action === 'save') {
            annotation.note.title = result.title;
            annotation.note.label = result.label;
            this._updateAnnotations();
            this._saveNetworkData();
            ui.notifications.info("Annotation updated");
        } else if (result.action === 'remove') {
            this.annotations.splice(index, 1);
            this._updateAnnotations();
            this._saveNetworkData();
            ui.notifications.info("Annotation removed");
        }
    }

    _toggleAnnotationMode() {
        // Check if d3-annotation is available
        if (!d3 || !d3.annotation) {
            ui.notifications.error('Annotation library not loaded. Please refresh the page and try again.');
            return;
        }

        this.annotationMode = !this.annotationMode;
        
        // If enabling annotation mode, disable linking mode
        if (this.annotationMode && this.linkingMode) {
            this.linkingMode = false;
            if (this.selectedNode) {
                this._highlightNode(this.selectedNode, false);
                this.selectedNode = null;
            }
            const linkButton = this.container.parentElement.querySelector('.toggle-linking');
            if (linkButton) {
                linkButton.classList.remove('active');
                linkButton.style.backgroundColor = '';
                linkButton.style.color = '';
            }
        }
        
        const button = this.container.parentElement.querySelector('.toggle-annotation');
        if (button) {
            button.classList.toggle('active', this.annotationMode);
            if (this.annotationMode) {
                button.style.backgroundColor = '#28a745';
                button.style.color = 'white';
            } else {
                button.style.backgroundColor = '';
                button.style.color = '';
            }
        }

        // Clear selections when exiting annotation mode
        if (!this.annotationMode) {
            this.selectedAnnotation = null;
        }

        // Update instructions
        this._updateInstructions();

        // Save the annotation mode state (but don't trigger re-render)
        this.widgetData.annotationMode = this.annotationMode;
        this.widgetData.linkingMode = this.linkingMode;
        
        // Save immediately to prevent position loss
        this._saveNetworkData();

        // Update annotation interactions without full re-render
        if (this.annotationElements && !this.annotationElements.empty()) {
            this._setupAnnotationInteractions();
        }

        // Add or remove SVG click handler for creating annotations
        if (this.annotationMode) {
            // In annotation arrange mode, we don't add click handlers for creation
            // Creation is handled by the dedicated "Create Annotation" button
            ui.notifications.info("Annotation arrange mode enabled. Click annotations to edit, drag to move, right-click to delete.");
        } else {
            this.svg.on('click.annotation', null);
            ui.notifications.info("Annotation arrange mode disabled.");
        }
    }

    async _onCreateAnnotationClick() {
        if (!d3 || !d3.annotation) {
            ui.notifications.error('Annotation library not loaded. Please refresh the page and try again.');
            return;
        }

        // Create annotation at center of visible area
        const svgRect = this.svg.node().getBoundingClientRect();
        const centerX = this.width / 2;
        const centerY = this.height / 2;
        
        await this._createAnnotation(centerX, centerY);
    }

    async _createAnnotation(x, y) {
        if (!d3 || !d3.annotation) {
            ui.notifications.error('Annotation library not loaded. Please refresh the page and try again.');
            return;
        }

        const result = await new Promise((resolve) => {
            new foundry.applications.api.DialogV2({
                window: { title: "Create Annotation" },
                content: `
                    <div style="margin-bottom: 15px;">
                        <label for="new-annotation-title" style="display: block; margin-bottom: 5px; font-weight: bold;">Title:</label>
                        <input type="text" id="new-annotation-title" 
                               placeholder="Annotation title..." 
                               style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; margin-bottom: 10px;">
                        <label for="new-annotation-label" style="display: block; margin-bottom: 5px; font-weight: bold;">Description:</label>
                        <textarea id="new-annotation-label" 
                                  placeholder="Annotation description..." 
                                  style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px; min-height: 60px;"></textarea>
                    </div>
                `,
                buttons: [
                    {
                        action: "create",
                        label: "Create",
                        callback: (event, button, dialog) => {
                            const titleInput = dialog.element.querySelector('#new-annotation-title');
                            const labelInput = dialog.element.querySelector('#new-annotation-label');
                            resolve({
                                action: 'create',
                                title: titleInput ? titleInput.value.trim() : '',
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

        if (result.action === 'create' && (result.title || result.label)) {
            const newAnnotation = {
                id: `annotation-${Date.now()}-${Math.random()}`,
                x: x,
                y: y,
                dx: 0,
                dy: 0,
                note: {
                    title: result.title,
                    label: result.label
                },
                type: d3.annotationLabel
            };

            this.annotations.push(newAnnotation);
            this._updateAnnotations();
            this._saveNetworkData();
            ui.notifications.info("Annotation created");
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
        
        console.log(`Network Widget | Node clicked: ${d.name}, linking mode: ${this.linkingMode}, annotation mode: ${this.annotationMode}, selected node: ${this.selectedNode?.name || 'none'}`);
        
        if (this.isGM && (this.linkingMode || this.annotationMode)) {
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
                <p>Customize <strong>${d.name}</strong>:</p>
                
                <!-- Visibility Section -->
                <div style="margin: 5px 0; padding: 12px;">
                    <h4 style="margin: 0 0 8px 0; font-size: 14px;">Visibility</h4>
                    <label style="display: flex; align-items: center; cursor: pointer;">
                        <input type="checkbox" id="hidden-checkbox" ${isHidden ? 'checked' : ''} style="margin-right: 8px;">
                        <span>Hidden from Players</span>
                    </label>
                    <p style="margin: 5px 0 0 24px; font-size: 11px; color: #666;">
                        Players see black circle with "?????"
                    </p>
                </div>

                <!-- Custom Name Section -->
                <div style="margin: 5px 0; padding: 12px;">
                    <h4 style="margin: 0 0 8px 0; font-size: 14px;">Display Name</h4>
                    <input type="text" id="custom-name" value="${d.customName || ''}" placeholder="Leave empty to use original name" 
                           style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px;">
                    <p style="margin: 5px 0 0 0; font-size: 11px; color: #666;">
                        Custom label for this node (visible to everyone)
                    </p>
                    ${d.type === 'Empty' ? `
                    <div style="margin-top: 10px;">
                        <label style="display: block; font-size: 12px; margin-bottom: 3px;">Text Color:</label>
                        <input type="color" id="empty-text-color" value="${d.textColor || '#444444'}" style="width: 100%; height: 30px; border: 1px solid #ccc; border-radius: 3px;">
                    </div>
                    ` : ''}
                </div>

                <!-- Appearance Section -->
                <div style="margin: 5px 0; padding: 12px;">
                    <h4 style="margin: 0 0 8px 0; font-size: 14px;">Appearance</h4>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 10px;">
                        <div>
                            <label style="display: block; font-size: 12px; margin-bottom: 3px;">Color:</label>
                            <input type="color" id="node-color" value="${d.nodeColor || '#69b3a2'}" 
                                   style="width: 100%; height: 30px; border: 1px solid #ccc; border-radius: 3px;">
                        </div>
                        <div>
                            <label style="display: block; font-size: 12px; margin-bottom: 3px;">Size:</label>
                            <select id="node-size" style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px;">
                                <option value="20" ${(d.nodeSize || 30) === 20 ? 'selected' : ''}>Small (20px)</option>
                                <option value="30" ${(d.nodeSize || 30) === 30 ? 'selected' : ''}>Normal (30px)</option>
                                <option value="40" ${(d.nodeSize || 30) === 40 ? 'selected' : ''}>Large (40px)</option>
                                <option value="50" ${(d.nodeSize || 30) === 50 ? 'selected' : ''}>XL (50px)</option>
                                <option value="70" ${(d.nodeSize || 30) === 70 ? 'selected' : ''}>XXL (70px)</option>
                            </select>
                        </div>
                    </div>
                    
                    <div>
                        <label style="display: block; font-size: 12px; margin-bottom: 3px;">Shape:</label>
                        <select id="node-shape" style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px;">
                            <option value="circle" ${(d.nodeShape || 'circle') === 'circle' ? 'selected' : ''}>Circle</option>
                            <option value="square" ${(d.nodeShape || 'circle') === 'square' ? 'selected' : ''}>Square</option>
                            <option value="diamond" ${(d.nodeShape || 'circle') === 'diamond' ? 'selected' : ''}>Diamond</option>
                            <option value="star" ${(d.nodeShape || 'circle') === 'star' ? 'selected' : ''}>Star</option>
                        </select>
                    </div>
                </div>

                <!-- Tooltip Section -->
                <div style="margin: 5px 0; padding: 12px;">
                    <h4 style="margin: 0 0 8px 0; font-size: 14px;">Custom Tooltip</h4>
                    <textarea id="custom-tooltip" placeholder="Leave empty to use display name" 
                              style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px; height: 60px; resize: vertical;">${d.customTooltip || ''}</textarea>
                    <p style="margin: 5px 0 0 0; font-size: 11px; color: #666;">
                        Custom hover text for this node
                    </p>
                </div>
            `,
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
                               style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
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
                               style="width: 100%; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
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
        
        // If enabling linking mode, disable annotation mode
        if (this.linkingMode && this.annotationMode) {
            this.annotationMode = false;
            const annotationButton = this.container.parentElement.querySelector('.toggle-annotation');
            if (annotationButton) {
                annotationButton.classList.remove('active');
                annotationButton.style.backgroundColor = '';
                annotationButton.style.color = '';
            }
            // Remove SVG click handler for annotations
            this.svg.on('click.annotation', null);
        }
        
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
        this.widgetData.annotationMode = this.annotationMode;
        this.widgetData.selectedNodeId = this.linkingMode && this.selectedNode ? this.selectedNode.id : null;
        
        // Save data to persist state
        this._saveNetworkData();

        ui.notifications.info(this.linkingMode ? "Linking mode enabled. Click two nodes to link/unlink them." : "Linking mode disabled.");
    }

    async _clearNetwork() {
        const proceed = await this.confirmationDialog("Are you sure you want to clear all nodes, links, and annotations from the network?");
        if (!proceed) return;

        this.nodes = [];
        this.links = [];
        this.annotations = [];
        this.nodeMap.clear();
        this.selectedNode = null;
        this.selectedAnnotation = null;
        this.linkingMode = false;
        this.annotationMode = false;
        
        const linkButton = this.container?.parentElement?.querySelector('.toggle-linking');
        if (linkButton) {
            linkButton.classList.remove('active');
            linkButton.style.backgroundColor = '';
            linkButton.style.color = '';
        }
        
        const annotationButton = this.container?.parentElement?.querySelector('.toggle-annotation');
        if (annotationButton) {
            annotationButton.classList.remove('active');
            annotationButton.style.backgroundColor = '';
            annotationButton.style.color = '';
        }

        this._updateNetwork(false); // Reset zoom when clearing network
        this._updateInstructions();
        
        // Clear all state
        this.widgetData.selectedNodeId = null;
        this.widgetData.linkingMode = false;
        this.widgetData.annotationMode = false;
        
        await this._saveNetworkData();
        ui.notifications.info("Network cleared.");
    }

    _onDragOver(event) {
        event.preventDefault();
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
                        textColor: node.textColor || '#444444'
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
                        y: node.y
                    };
                }
            }),
            links: this.links.map(link => ({
                source: typeof link.source === 'object' ? link.source.id : link.source,
                target: typeof link.target === 'object' ? link.target.id : link.target,
                label: link.label || ''
            })),
            annotations: this.annotations.map(annotation => ({
                id: annotation.id,
                x: annotation.x,
                y: annotation.y,
                dx: annotation.dx,
                dy: annotation.dy,
                title: annotation.note.title || '',
                label: annotation.note.label || ''
            })),
            floatingImages: this.floatingImages.map(img => ({ ...img })),
            linkingMode: this.linkingMode || false,
            annotationMode: this.annotationMode || false,
            selectedNodeId: this.selectedNode ? this.selectedNode.id : null
        };

        console.log('Network Widget | Saving data:', JSON.stringify(dataToSave, null, 2));
        console.log('Network Widget | Links array being saved:', this.links);
        console.log('Network Widget | Annotations array being saved:', this.annotations);
        
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

    async close() {
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