import { Chart, ChartConfiguration, registerables } from 'chart.js';
import './date-adapter/chartjs-adapter-moment.esm.js';
import { MarkdownPostProcessorContext, MarkdownRenderChild, parseYaml, TFile } from 'obsidian';
import { generateInnerColors, renderError } from 'src/util';
import type { ChartPluginSettings, ImageOptions } from './constants/settingsConstants';
import type ChartPlugin from 'src/main';
import { generateTableData } from 'src/chartFromTable';
Chart.register(...registerables);

// I need to refactor this
// Or just rewrite it completely
// Its a mess

export default class Renderer {
    plugin: ChartPlugin;

    constructor(plugin: ChartPlugin) {
        this.plugin = plugin;
    }

    async datasetPrep(yaml: any, el: HTMLElement, themeColors = false): Promise<{ chartOptions: ChartConfiguration; width: string; }> {
        let datasets = [];
        if (!yaml.id) {
            const colors = [];
            if (this.plugin.settings.themeable || themeColors) {
                let i = 1;
                while (true) {
                    let color = getComputedStyle(el).getPropertyValue(`--chart-color-${i}`);
                    if (color) {
                        colors.push(color);
                        i++;
                    } else {
                        break;
                    }
                }
            }
            for (let i = 0; yaml.series.length > i; i++) {
                datasets.push({
                    label: yaml.series[i].title ?? "",
                    data: yaml.series[i].data,
                    backgroundColor: yaml.labelColors ? colors.length ? generateInnerColors(colors) : generateInnerColors(this.plugin.settings.colors) : colors.length ? generateInnerColors(colors)[i] : generateInnerColors(this.plugin.settings.colors)[i],
                    borderColor: yaml.labelColors ? colors.length ? colors : this.plugin.settings.colors : colors.length ? colors[i] : this.plugin.settings.colors[i],
                    borderWidth: 1,
                    fill: yaml.fill ?? false,
                    tension: yaml.tension ?? 0,
                });
            }
        }

        let labels = yaml.labels;

        const gridColor = getComputedStyle(el).getPropertyValue('--background-modifier-border');

        let chartOptions;

        Chart.defaults.color = getComputedStyle(el).getPropertyValue('--text-muted');
        Chart.defaults.font.family = getComputedStyle(el).getPropertyValue('--mermaid-font');
        Chart.defaults.plugins = {
            legend: {
                display: yaml.legend,
                position: yaml.legendPosition
            },
            ...Chart.defaults.plugins
        };


        if (yaml.type == 'radar' || yaml.type == 'polarArea') {
            chartOptions = {
                type: yaml.type,
                data: {
                    labels,
                    datasets
                },
                options: {
                    spanGaps: yaml.spanGaps,
                    scales: {
                        r: {
                            grid: { color: gridColor },
                            beginAtZero: yaml.beginAtZero
                        },
                    },
                    layout: {
                        padding: yaml.padding
                    }
                }
            };
        } else if (yaml.type == 'bar' || yaml.type == 'line') {
            chartOptions = {
                type: yaml.type,
                data: {
                    labels,
                    datasets
                },
                options: {
                    indexAxis: yaml.indexAxis,
                    spanGaps: yaml.spanGaps,
                    scales: {
                        y: {
                            min: yaml.yMin,
                            max: yaml.yMax,
                            reverse: yaml.yReverse,
                            ticks: {
                                display: yaml.yTickDisplay,
                                padding: yaml.yTickPadding
                            },
                            display: yaml.yDisplay,
                            stacked: yaml.stacked,
                            beginAtZero: yaml.beginAtZero,
                            grid: { color: gridColor },
                            title: {
                                display: yaml.yTitle,
                                text: yaml.yTitle
                            }
                        },
                        x: {
                            min: yaml.xMin,
                            max: yaml.xMax,
                            reverse: yaml.xReverse,
                            ticks: {
                                display: yaml.xTickDisplay,
                                padding: yaml.xTickPadding
                            },
                            display: yaml.xDisplay,
                            stacked: yaml.stacked,
                            grid: { color: gridColor },
                            title: {
                                display: yaml.xTitle,
                                text: yaml.xTitle
                            }
                        }
                    },
                    layout: {
                        padding: yaml.padding
                    }
                }
            };
        } else {
            chartOptions = {
                type: yaml.type,
                data: {
                    labels,
                    datasets
                },
                options: {
                    spanGaps: yaml.spanGaps,
                    layout: {
                        padding: yaml.padding
                    }
                }
            };
        }
        return { chartOptions, width: yaml.width };
    }

    /**
     * @param yaml the copied codeblock
     * @returns base64 encoded image in png format
     */
    async imageRenderer(yaml: string, options: ImageOptions): Promise<string> {
        const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
        const destination = document.createElement('canvas');
        const destinationContext = destination.getContext("2d");

        const chartOptions = await this.datasetPrep(await parseYaml(yaml.replace("```chart", "").replace("```", "").replace(/\t/g, '    ')), document.body);

        new Chart(destinationContext, chartOptions.chartOptions);

        document.body.append(destination);
        await delay(250);
        const dataurl = destination.toDataURL(options.format, options.quality);
        document.body.removeChild(destination);

        return dataurl.substring(dataurl.indexOf(',') + 1);
    }

    renderRaw(data: any, el: HTMLElement): Chart | null {
        const destination = el.createEl('canvas');

        if (data.chartOptions) {
            try {
                let chart = new Chart(destination.getContext("2d"), data.chartOptions);
                destination.parentElement.style.width = data.width ?? "100%";
                destination.parentElement.style.margin = "auto";
                return chart;
            } catch (error) {
                renderError(error, el);
                return null;
            }
        } else {
            try {
                let chart = new Chart(destination.getContext("2d"), data);
                return chart;
            } catch (error) {
                renderError(error, el);
                return null;
            }
        }
    }

    async renderFromYaml(yaml: any, el: HTMLElement, ctx: MarkdownPostProcessorContext) {
        this.plugin.app.workspace.onLayoutReady(() => ctx.addChild(new ChartRenderChild(yaml, el, this, ctx.sourcePath)));
    }
}

class ChartRenderChild extends MarkdownRenderChild {
    data: any;
    chart: null | Chart;
    renderer: Renderer;
    ownPath: string;
    el: HTMLElement;

    constructor(data: any, el: HTMLElement, renderer: Renderer, ownPath: string) {
        super(el);
        this.el = el;
        this.data = data;
        this.renderer = renderer;
        this.ownPath = ownPath;
        this.eventHandler = this.eventHandler.bind(this);
    }

    async onload() {
        try {
            const data = await this.renderer.datasetPrep(this.data, this.el);
            let x: any = {};
            if (this.data.id) {
                const colors = [];
                if (this.renderer.plugin.settings.themeable) {
                    let i = 1;
                    while (true) {
                        let color = getComputedStyle(this.el).getPropertyValue(`--chart-color-${i}`);
                        if (color) {
                            colors.push(color);
                            i++;
                        } else {
                            break;
                        }
                    }
                }
                x.datasets = [];
                let linkDest: TFile;
                if (this.data.file) linkDest = this.renderer.plugin.app.metadataCache.getFirstLinkpathDest(this.data.file, this.renderer.plugin.app.workspace.getActiveFile().path);
                const pos = this.renderer.plugin.app.metadataCache.getFileCache(
                    linkDest ?? this.renderer.plugin.app.vault.getAbstractFileByPath(this.ownPath) as TFile).sections.find(pre => pre.id === this.data.id)?.position;
                if (!pos) {
                    throw "Invalid id and/or file";
                }

                const tableString = (await this.renderer.plugin.app.vault.cachedRead(this.data.file ? linkDest : this.renderer.plugin.app.vault.getAbstractFileByPath(this.ownPath) as TFile)).substring(pos.start.offset, pos.end.offset);
                let tableData;
                try {
                    tableData = generateTableData(tableString, this.data.layout ?? 'columns');
                } catch (error) {
                    throw "There is no table at that id and/or file"
                }
                x.labels = tableData.labels;
                for (let i = 0; tableData.dataFields.length > i; i++) {
                    x.datasets.push({
                        label: tableData.dataFields[i].dataTitle ?? "",
                        data: tableData.dataFields[i].data,
                        backgroundColor: this.data.labelColors ? colors.length ? generateInnerColors(colors) : generateInnerColors(this.renderer.plugin.settings.colors) : colors.length ? generateInnerColors(colors)[i] : generateInnerColors(this.renderer.plugin.settings.colors)[i],
                        borderColor: this.data.labelColors ? colors.length ? colors : this.renderer.plugin.settings.colors : colors.length ? colors[i] : this.renderer.plugin.settings.colors[i],
                        borderWidth: 1,
                        fill: this.data.fill ?? false,
                        tension: this.data.tension ?? 0,
                    });
                }
                data.chartOptions.data.labels = x.labels;
                data.chartOptions.data.datasets = x.datasets;


                this.chart = this.renderer.renderRaw(data, this.containerEl);
            }
        } catch (error) {
            renderError(error, this.el);
        }
        if (this.data.id) {
            this.renderer.plugin.app.metadataCache.on("changed", this.eventHandler);
        }
    }

    eventHandler(file: TFile) {
        if (this.data.file ? file.basename === this.data.file : file.path === this.ownPath) {
            this.onunload();
            this.onload();
        }
    }

    onunload() {
        this.el.empty();
        this.chart && this.chart.destroy();
        this.chart = null;
        this.renderer.plugin.app.metadataCache.off("changed", this.eventHandler);
    }
}
