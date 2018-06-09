const ccxt = require("ccxt");
const config = require("./config");
const fetch = require("node-fetch");
const schedule = require("node-schedule");
require("console-stamp")(console);
const app = {
    sum: 0,
    done: [],
    ticker: [],
    minimums: {},
    portfolio: [],
    exchanges: {},
    changes: [],
    balance: {},
    markets: {},
    prices: {},
    pairs: [],
    ready: 0,
    btcusd: 0,
    global: {},
    update: () => {
        config.exchanges.forEach(exchange => {
            if (config.balances) {
                Object.keys(app.balance[exchange]).forEach(key => {
                    console.log(key.padEnd(5), app.balance[exchange][key].toFixed(4));
                });
            }
            let totalCap = 0, portfolio = [], tokens = [], change = 0, capped = 0;
            app.markets[exchange].forEach(market => tokens.push(market));
            if (!config.automatic) {
                if (!config.manual[exchange] || Object.values(config.manual[exchange]).reduce((a, b) => a + b) !== 100) {
                    return;
                } else {
                    config.size = undefined;
                }
            }
            const filtered = app.ticker.filter(item => {
                return tokens.indexOf(item.symbol) > -1 && app.done.indexOf(item.symbol) < 0 && config.excludes.indexOf(item.symbol) < 0;
            }).sort((a, b) => {
                if (config.automatic) {
                    return b.market_cap_usd - a.market_cap_usd;
                } else {
                    return config.manual[exchange][b.symbol] - config.manual[exchange][a.symbol];
                }
            }).slice(0, config.size);
            filtered.forEach(item => totalCap += parseFloat(item.market_cap_usd));
            filtered.forEach(item => {
                if (!config.automatic) {
                    item.market_cap_weight = config.manual[exchange][item.symbol] || 0;
                } else {
                    item.market_cap_weight = (100 * parseFloat(item.market_cap_usd)) / totalCap + change;
                }
                if (item.market_cap_weight > config.maximum) {
                    capped++;
                    change += (item.market_cap_weight - config.maximum) / (filtered.length - capped);
                    item.market_cap_weight = config.maximum;
                }
                portfolio.push([item.name, item.market_cap_weight.toFixed(2)]);
            });
            if (config.hierarchical) {
                app.done = app.done.concat(tokens);
            }
            if (config.portfolio) {
                portfolio.forEach(item => {
                    console.log(item[0].padEnd(19), (item[1] + "%").padStart(6));
                });
            }
            app.portfolio = portfolio;
            app.rebalance(exchange);
        });
    },
    rebalance: exchange => {
        let sum = 0,
            actions = [],
            steps = [],
            trades = [],
            counter = 0,
            changes = 0,
            health = 0,
            minimum = 0;
        app.ticker.forEach((item, index) => {
            if (!item.price) {
                app.ticker[index].price = {};
            }
            if (config.bases[exchange] === "BTC") {
                app.ticker[index].price[exchange] = item.price_btc[exchange];
                app.ticker[index].market_cap = item.market_cap_btc;
            } else {
                app.ticker[index].price[exchange] = item.price_usd[exchange];
                app.ticker[index].market_cap = item.market_cap_usd;
            }
        });
        app.ticker.forEach((item, index) => {
            if (item.amount) {
                sum += (item.amount[exchange] || 0) * (item.price[exchange] || 0);
            }
            app.ticker[index].rebalance = 0;
        });
        app.ticker.forEach((item, index) => {
            if (item.amount) {
                app.portfolio.forEach(token => {
                    if (token[0] === item.name) {
                        app.ticker[index].rebalance = (item.amount[exchange] || 0) * item.price[exchange] - (sum * parseFloat(token[1])) / 100;
                    } else if (app.ticker[index].rebalance === 0) {
                        app.ticker[index].rebalance = (item.amount[exchange] || 0) * item.price[exchange];
                    }
                });
            }
        });
        app.ticker.forEach((item, index) => {
            if (item.rebalance) {
                steps.push(item.rebalance);
            } else {
                steps.push(0);
            }
            if (index === app.ticker.length - 1) {
                app.changes = steps;
            }
        });
        if (config.bases[exchange] === "BTC") {
            minimum = 10 / app.btcusd;
        } else {
            minimum = 10;
        }
        while (counter < 101 && app.changes.reduce((a, b) => Math.abs(a) + Math.abs(b), 0) !== 0) {
            let largest = app.changes.indexOf(Math.max.apply(Math, app.changes));
            let smallest = app.changes.indexOf(Math.min.apply(Math, app.changes));
            if (Math.abs(app.changes[largest]) - Math.abs(app.changes[smallest]) > 0) {
                if (Math.abs(app.changes[largest]) > minimum) {
                    changes += Math.abs(app.changes[smallest]);
                    actions.push([
                        Math.abs(app.changes[smallest]) / parseFloat(app.ticker[largest].price[exchange]),
                        app.ticker[largest].symbol,
                        app.ticker[smallest].symbol,
                        Math.abs(app.changes[smallest]) / parseFloat(app.ticker[smallest].price[exchange])
                    ]);
                    app.changes[largest] -= Math.abs(app.changes[smallest]);
                    app.changes[smallest] += Math.abs(app.changes[smallest]);
                } else {
                    app.changes[largest] = 0;
                }
            } else {
                if (Math.abs(app.changes[smallest]) > minimum) {
                    changes += Math.abs(app.changes[largest]);
                    actions.push([
                        Math.abs(app.changes[largest]) / parseFloat(app.ticker[largest].price[exchange]),
                        app.ticker[largest].symbol,
                        app.ticker[smallest].symbol,
                        Math.abs(app.changes[largest]) / parseFloat(app.ticker[smallest].price[exchange])
                    ]);
                    app.changes[smallest] += Math.abs(app.changes[largest]);
                    app.changes[largest] -= Math.abs(app.changes[largest]);
                } else {
                    app.changes[smallest] = 0;
                }
            }
            counter++;
        }
        if (changes / sum < 0.01) {
            actions = [];
        }
        if (sum > 0) {
            health = Math.round(100 - (changes / sum) * 100);
        }
        if (config.bases[exchange] === "BTC") {
            sum *= app.btcusd;
        }
        app.sum += sum;
        console.log("\x1b[33m" + exchange.toUpperCase(), sum.toFixed(2), "USD", "[" + health + "%]\x1b[0m");
        actions.forEach((data, index) => {
            actions[index][3] = data[3] - (data[3] * (config.reserve / 100)) / actions.length;
            console.log("Exchange", data[0].toFixed(4), data[1], "for", data[3].toFixed(4), data[2]);
        });
        if (exchange === config.exchanges[config.exchanges.length - 1]) {
            console.log("\x1b[33mTOTAL:", app.sum.toFixed(2), "USD\x1b[0m");
        }
        if (health < config.threshold) {
            let sold = [], bought = [];
            actions = actions.filter(data => {
                return data[0] >= app.minimums[exchange][data[1] + "/" + config.bases[exchange]] && data[3] >= app.minimums[exchange][data[2] + "/" + config.bases[exchange]];
            });
            actions.forEach(data => {
                let amount = 0;
                actions.forEach(item => {
                    if (data[1] === item[1] && sold.indexOf(data[1]) < 0) {
                        amount += item[0];
                    }
                });
                if (amount > 0) {
                    trades.push([exchange, "sell", amount, data[1]]);
                }
                sold.push(data[1]);
            });
            actions.forEach(data => {
                let amount = 0;
                actions.forEach(item => {
                    if (data[2] === item[2] && bought.indexOf(data[2]) < 0) {
                        amount += item[3];
                    }
                });
                if (amount > 0) {
                    trades.push([exchange, "buy", amount, data[2]]);
                }
                bought.push(data[2]);
            });
            if (config.trade) {
                trades.forEach((data, index) => {
                    setTimeout(() => {
                        trade(data[0], data[1], data[2], data[3]);
                    }, config.delay * index);
                });
            }
        }
    }
};
const isReady = () => {
    app.ready++;
    if (app.ready - 7 === config.exchanges.length * 3) {
        app.ticker.forEach((item, index) => {
            app.ticker[index].price_btc = item.price_usd / global.btcPrice;
            app.ticker[index].market_cap_usd *= config.weights[item.symbol] || 1;
            config.exchanges.forEach(exchange => {
                app.markets[exchange].forEach(token => {
                    if (item.symbol === token) {
                        if (!app.ticker[index].amount) {
                            app.ticker[index].amount = {};
                        }
                        if (typeof app.ticker[index].price_usd !== "object") {
                            app.ticker[index].price_usd = {};
                        }
                        if (typeof app.ticker[index].price_btc !== "object") {
                            app.ticker[index].price_btc = {};
                        }
                        app.ticker[index].price_usd[exchange] = app.prices[exchange][token + "/USD"] || 0;
                        app.ticker[index].price_btc[exchange] = app.prices[exchange][token + "/BTC"] || 0;
                        app.ticker[index].amount[exchange] = app.balance[exchange][token] || 0;
                    }
                });
            });
        });
        app.btcusd = app.prices.bitstamp["BTC/USD"];
        app.update();
    }
};
const loadData = () => {
    fetch("http://coincap.io/front").then(result => {
        return result.json();
    }).then(data => {
        data.forEach(item => {
            app.ticker.push({
                name: item.long,
                price_usd: item.price,
                market_cap_usd: item.mktcap,
                symbol: item.short == "IOT" ? "IOTA" : item.short
            });
        });
        isReady();
    }).catch(error => {
        console.log("\x1b[31m" + error + "\x1b[0m");
    });
    fetch("http://coincap.io/global").then(result => {
        return result.json();
    }).then(data => {
        app.global = data;
        isReady();
    }).catch(error => {
        console.log("\x1b[31m" + error + "\x1b[0m");
    });
    config.exchanges.forEach(exchange => {
        app.prices[exchange] = {};
        (async () => {
            await eval(app.exchanges[exchange]).fetchBalance().then(data => {
                app.balance[exchange] = data.free;
                isReady();
            }).catch(error => {
                console.log("\x1b[31m" + error + "\x1b[0m");
            });
            await eval(app.exchanges[exchange]).fetchMarkets().then(data => {
                data.forEach(pair => {
                    if (!app.minimums[exchange]) {
                        app.minimums[exchange] = {};
                    }
                    app.minimums[exchange][pair.symbol] = pair.limits.amount.min;
                    if (!app.markets[exchange]) {
                        app.markets[exchange] = [];
                    }
                    if (pair.quote === config.bases[exchange]) {
                        app.markets[exchange].push(pair.base);
                    }
                    if (!app.pairs[exchange]) {
                        app.pairs[exchange] = [];
                    }
                    app.pairs[exchange].push(pair.symbol);
                    if (exchange === "bitstamp" && config.bases[exchange] === pair.symbol.substring(pair.symbol.indexOf("/") + 1)) {
                        eval(app.exchanges[exchange]).fetchTicker(pair.symbol).then(symbol => {
                            app.prices[exchange][pair.symbol] = symbol.last;
                            isReady();
                        });
                    }
                });
                isReady();
            }).catch(error => {
                console.log("\x1b[31m" + error + "\x1b[0m");
            });
            if (exchange !== "bitstamp") {
                await eval(app.exchanges[exchange]).fetchTickers().then(data => {
                    Object.keys(data).forEach(key => {
                        app.prices[exchange][data[key].symbol] = data[key].last;
                    });
                    isReady();
                }).catch(error => {
                    console.log("\x1b[31m" + error + "\x1b[0m");
                });
            }
        })();
    });
};
const trade = (exchange, type, amount, symbol) => {
    console.log(type.toUpperCase() + "ING", amount.toFixed(4), symbol, "on", exchange.toUpperCase());
    if (type === "buy") {
        eval(app.exchanges[exchange]).createMarketBuyOrder(symbol + "/" + config.bases[exchange], amount.toFixed(8)).catch(error => console.log("\x1b[31m" + error + "\x1b[0m"));
    } else if (type === "sell") {
        eval(app.exchanges[exchange]).createMarketSellOrder(symbol + "/" + config.bases[exchange], amount.toFixed(8)).catch(error => console.log("\x1b[31m" + error + "\x1b[0m"));
    }
};
if (config.schedule) {
    schedule.scheduleJob(config.schedule, () => {
        app.ready = 0;
        app.done = [];
        app.sum = 0;
        loadData();
    });
}
config.exchanges.forEach(exchange => {
    if (config.verbose) {
        config.keys[exchange].verbose = true;
    }
    app.exchanges[exchange] = new ccxt[exchange](config.keys[exchange]);
});
if (!config.schedule) {
    loadData();
}
