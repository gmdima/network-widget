// Register settings for background, node label, and link colors
Hooks.once("init", function () {
    if (typeof game !== 'undefined' && game.settings) {
        if (!game.settings.settings?.has('network-widget.backgroundColor')) {
            game.settings.register('network-widget', 'backgroundColor', {
                name: 'Network Map Background Color',
                hint: 'Set the background color of the network map (CSS color, e.g. #fff, #222, rgba(0,0,0,0.5), etc.)',
                scope: 'client',
                config: true,
                type: String,
                default: '#f9f9f9',
                onChange: value => {
                    document.querySelectorAll('.network-container svg').forEach(svg => svg.style.background = value);
                }
            });
        }
        if (!game.settings.settings?.has('network-widget.nodeLabelColor')) {
            game.settings.register('network-widget', 'nodeLabelColor', {
                name: 'Node Label Text Color',
                hint: 'Set the color of node label text (CSS color, e.g. #222, #fff, red, etc.)',
                scope: 'client',
                config: true,
                type: String,
                default: '#333',
            });
        }
        if (!game.settings.settings?.has('network-widget.linkColor')) {
            game.settings.register('network-widget', 'linkColor', {
                name: 'Link Line Color',
                hint: 'Set the color of the link lines (CSS color, e.g. #666, #ff0000, etc.)',
                scope: 'client',
                config: true,
                type: String,
                default: '#666',
            });
        }
        if (!game.settings.settings?.has('network-widget.linkLabelOutlineColor')) {
            game.settings.register('network-widget', 'linkLabelOutlineColor', {
                name: 'Link Label Outline Color',
                hint: 'Set the outline (stroke) color of link label text (CSS color, e.g. #fff, #000, etc.)',
                scope: 'client',
                config: true,
                type: String,
                default: '#fff',
            });
        }
    }
});
import { createNetworkWidget } from "./widgets/NetworkWidget.js";

Hooks.once("ready", async function () {
    const ccApi = game.modules.get('campaign-codex')?.api;
    if (!ccApi) {
        console.error("My Module | Campaign Codex API not found!");
        return;
    }

    const { CampaignCodexWidget, widgetManager } = ccApi;

    const NetworkWidget = createNetworkWidget(CampaignCodexWidget);


    widgetManager.registerWidget("network", NetworkWidget);

    
    console.log("My Module | Custom widgets registered with Campaign Codex.");
});