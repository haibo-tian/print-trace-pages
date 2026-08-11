/**
 * 追溯二维码 CEP 插件 - 主逻辑
 * @module main
 */

(function() {
    "use strict";

    // ---- CEP 接口 ----
    var cs = null;
    try {
        cs = new CSInterface();
    } catch (e) {
        console.log("Not in CEP environment, running in browser mode");
    }

    // ---- 状态变量 ----
    var currentSVG = "";
    var currentLayoutId = "";
    var currentLayoutName = "";

    // ---- 服务器配置（GitHub Pages 托管查询页面） ----
    var TRACE_SERVER_CUSTOM = "https://zj-trace.online";
    var TRACE_SERVER_GITHUB = "https://haibo-tian.github.io/print-trace-pages";
    var TRACE_SERVER = TRACE_SERVER_CUSTOM; // 使用自定义域名，微信扫码更稳定
    // ---- DOM 元素 ----
    var elConfigToggle = document.getElementById("configToggle");
    var elToggleIcon = document.getElementById("toggleIcon");
    var elConfigContent = document.getElementById("configContent");
    var elAppId = document.getElementById("appId");
    var elAppSecret = document.getElementById("appSecret");
    var elAppToken = document.getElementById("appToken");
    var elTableId = document.getElementById("tableId");
    var elSaveConfigBtn = document.getElementById("saveConfigBtn");
    var elLayoutName = document.getElementById("layoutName");
    var elMaterialSelect = document.getElementById("materialSelect");
    var elMaterialCustom = document.getElementById("materialCustom");
    var elProcessReq = document.getElementById("processReq");
    var elMoldNo = document.getElementById("moldNo");
    var elQuantity = document.getElementById("quantity");
    var elGenerateBtn = document.getElementById("generateBtn");
    var elResultCard = document.getElementById("resultCard");
    var elQrPreview = document.getElementById("qrPreview");
    var elResultLayoutId = document.getElementById("resultLayoutId");
    var elResultLayoutName = document.getElementById("resultLayoutName");
    var elInsertBtn = document.getElementById("insertBtn");
    var elSaveSvgBtn = document.getElementById("saveSvgBtn");
    var elCopySvgBtn = document.getElementById("copySvgBtn");
    var elStatusText = document.getElementById("statusText");

    // IME 输入状态标记（防止中文输入法下误触回车提交）
    var isComposing = false;

    // ---- 日志函数 ----
    function log(msg, type) {
        var time = new Date().toLocaleTimeString();
        var text = "[" + time + "] " + msg;
        elStatusText.textContent = text;
        elStatusText.className = "status-text" + (type ? " " + type : "");
        console.log(text);
    }

    // ---- 配置管理 ----
    function loadConfig() {
        try {
            var saved = localStorage.getItem("trace_qr_config");
            if (saved) {
                var cfg = JSON.parse(saved);
                elAppId.value = cfg.appId || "";
                elAppSecret.value = cfg.appSecret || "";
                elAppToken.value = cfg.appToken || "";
                elTableId.value = cfg.tableId || "";
                log("配置已从本地加载");
            }
        } catch (e) {
            log("加载配置失败: " + e.message, "error");
        }
    }

    function saveConfig() {
        try {
            var cfg = {
                appId: elAppId.value.trim(),
                appSecret: elAppSecret.value.trim(),
                appToken: elAppToken.value.trim(),
                tableId: elTableId.value.trim()
            };
            localStorage.setItem("trace_qr_config", JSON.stringify(cfg));

            // 同步到 core CONFIG
            if (typeof CONFIG !== "undefined") {
                CONFIG.FEISHU_APP_ID = cfg.appId;
                CONFIG.FEISHU_APP_SECRET = cfg.appSecret;
                CONFIG.BITABLE_APP_TOKEN = cfg.appToken;
                CONFIG.BITABLE_TABLE_ID = cfg.tableId;
            }
            log("配置已保存", "success");
        } catch (e) {
            log("保存配置失败: " + e.message, "error");
            alert("保存配置失败: " + e.message);
        }
    }

    function getConfig() {
        if (typeof CONFIG !== "undefined") return CONFIG;
        return {
            FEISHU_APP_ID: elAppId.value.trim(),
            FEISHU_APP_SECRET: elAppSecret.value.trim(),
            BITABLE_APP_TOKEN: elAppToken.value.trim(),
            BITABLE_TABLE_ID: elTableId.value.trim(),
            FIELDS: {
                LAYOUT_ID: "\u7248\u9762\u552F\u4E00ID",
                LAYOUT_NAME: "\u6392\u7248\u540D\u79F0",
                PROCESS: "\u5DE5\u5E8F",
                STATUS: "\u72B6\u6001",
                CREATED_AT: "\u521B\u5EFA\u65F6\u95F4",
                UPDATED_AT: "\u66F4\u65B0\u65F6\u95F4"
            }
        };
    }

    // ---- 主流程：生成追溯二维码 ----
    function generateTraceQR() {
        try {
            var name = elLayoutName.value.trim();
            if (!name) {
                alert("\u8BF7\u8F93\u5165\u6392\u7248\u540D\u79F0");
                log("\u6392\u7248\u540D\u79F0\u4E3A\u7A7A", "error");
                return;
            }
            if (name.length > 100) {
                alert("\u6392\u7248\u540D\u79F0\u8FC7\u957F\uFF0C\u6700\u591A100\u4E2A\u5B57\u7B26");
                log("\u6392\u7248\u540D\u79F0\u8FC7\u957F", "error");
                return;
            }

            log("\u6B63\u5728\u751F\u6210\u7248\u9762ID...");
            var layoutId = generateLayoutId();
            log("\u7248\u9762ID: " + layoutId);

            var cfg = getConfig();
            var hasFeishuConfig = cfg.FEISHU_APP_ID && cfg.FEISHU_APP_SECRET && cfg.BITABLE_APP_TOKEN && cfg.BITABLE_TABLE_ID;

            // 读取新增字段（材质从下拉框或自定义输入读取）
            var material = "";
            if (elMaterialSelect && elMaterialSelect.value === "__custom__") {
                material = elMaterialCustom ? elMaterialCustom.value.trim() : "";
            } else if (elMaterialSelect) {
                material = elMaterialSelect.value;
            }
            var processReq = elProcessReq ? elProcessReq.value.trim() : "";
            var moldNo = elMoldNo ? elMoldNo.value.trim() : "";
            var quantity = elQuantity ? elQuantity.value.trim() : "";

            // 创建飞书记录（如有配置）
            if (hasFeishuConfig) {
                log("\u6B63\u5728\u521B\u5EFA\u98DE\u4E66\u8BB0\u5F55...");
                var api = new FeishuBitableAPI(cfg);
                var now = Date.now();
                var fields = {};
                fields[cfg.FIELDS.LAYOUT_ID] = layoutId;
                fields[cfg.FIELDS.LAYOUT_NAME] = name;
                fields[cfg.FIELDS.STATUS] = "\u5DF2\u521B\u5EFA";
                fields[cfg.FIELDS.CREATED_AT] = now;
                fields[cfg.FIELDS.UPDATED_AT] = now;
                // 新增工艺信息字段
                if (material) fields["\u6750\u8D28"] = material;
                if (processReq) fields["\u5DE5\u827A"] = processReq;
                if (moldNo) fields["\u5200\u6A21"] = moldNo;
                if (quantity) fields["\u6570\u91CF"] = quantity;

                api.createRecord(fields).then(function(data) {
                    log("\u98DE\u4E66\u8BB0\u5F55\u521B\u5EFA\u6210\u529F", "success");
                    showResult(layoutId, name);
                }).catch(function(err) {
                    log("\u98DE\u4E66\u8BB0\u5F55\u521B\u5EFA\u5931\u8D25: " + err.message, "error");
                    // 即使飞书失败也继续生成二维码
                    showResult(layoutId, name);
                });
            } else {
                log("\u672A\u914D\u7F6E\u98DE\u4E66\u51ED\u8BC1\uFF0C\u4EC5\u751F\u6210\u672C\u5730\u4E8C\u7EF4\u7801");
                showResult(layoutId, name);
            }

        } catch (e) {
            log("\u751F\u6210\u5931\u8D25: " + e.message, "error");
            alert("\u751F\u6210\u5931\u8D25: " + e.message);
        }
    }

    function showResult(layoutId, name) {
        currentLayoutId = layoutId;
        currentLayoutName = name;

        // 构造追溯URL → 参数名用纯英文，兼容微信扫码
        var traceUrl = TRACE_SERVER + "/report.html?" + encodeURIComponent("排版名称") + "=" + encodeURIComponent(name);

        log("生成QR矩阵...");
        try {
            // 使用标准 qrcode-generator 库
            var qr = qrcode(0, 'M');
            qr.addData(traceUrl, 'Byte');
            qr.make();

            // 从矩阵构建 SVG
            var moduleCount = qr.getModuleCount();
            var moduleSize = 8;
            var margin = 4;
            var totalSize = (moduleCount + margin * 2) * moduleSize;
            var offset = margin * moduleSize;
            var pathParts = [];
            for (var r = 0; r < moduleCount; r++) {
                var c = 0;
                while (c < moduleCount) {
                    if (qr.isDark(r, c)) {
                        var startC = c;
                        while (c < moduleCount && qr.isDark(r, c)) c++;
                        var runLen = c - startC;
                        var x = offset + startC * moduleSize;
                        var y = offset + r * moduleSize;
                        pathParts.push('M' + x + ',' + y + 'h' + (runLen * moduleSize) + 'v' + moduleSize + 'h-' + (runLen * moduleSize) + 'z');
                    } else {
                        c++;
                    }
                }
            }
            var svg = '<?xml version="1.0" encoding="UTF-8"?>\n';
            svg += '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + totalSize + ' ' + totalSize + '" width="' + totalSize + '" height="' + totalSize + '">';
            svg += '<rect width="100%" height="100%" fill="#ffffff"/>';
            if (pathParts.length > 0) {
                svg += '<path d="' + pathParts.join('') + '" fill="#000000"/>';
            }
            svg += '</svg>';

            currentSVG = svg;
            
            elQrPreview.innerHTML = svg;
            elResultLayoutId.textContent = layoutId;
            elResultLayoutName.textContent = name;
            elResultCard.style.display = "block";

            log("二维码生成成功", "success");
        } catch (e) {
            log("QR生成失败: " + e.message, "error");
            alert("QR生成失败: " + e.message);
        }
    }

    // ---- 按钮操作 ----

    // 插入AI画布（将SVG渲染为PNG后通过placedItems置入AI）
    function insertToAI() {
        if (!currentSVG) {
            alert("请先生成二维码");
            return;
        }
        if (!cs) {
            alert("当前不在 CEP 环境中，无法插入AI画布");
            return;
        }

        try {
            log("正在转换SVG为PNG...");

            // 1. 将SVG渲染到canvas，导出PNG base64
            var img = new Image();
            var svgBlob = new Blob([currentSVG], { type: "image/svg+xml;charset=utf-8" });
            var url = URL.createObjectURL(svgBlob);

            img.onload = function() {
                var canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;
                var ctx = canvas.getContext("2d");
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0);
                URL.revokeObjectURL(url);

                // 2. 导出PNG base64
                var dataUrl = canvas.toDataURL("image/png");
                var base64 = dataUrl.split(",")[1];

                // 3. 通过Node.js写入PNG文件
                var os = require("os");
                var fs = require("fs");
                var tmpPath = os.tmpdir() + "\\trace_qr_temp.png";
                fs.writeFileSync(tmpPath, Buffer.from(base64, "base64"));
                var pngPath = tmpPath.replace(/\\/g, "/");

                // 4. 调用JSX置入PNG
                var jsx = 'placePNGFile("' + pngPath + '")';
                cs.evalScript(jsx, function(result) {
                    if (result.indexOf("success") === 0) {
                        log("已插入到AI画布: " + result, "success");
                    } else {
                        log("插入失败: " + result, "error");
                        alert("插入失败: " + result);
                    }
                });
            };

            img.onerror = function() {
                URL.revokeObjectURL(url);
                log("SVG转PNG失败", "error");
                alert("SVG渲染失败，请重试");
            };

            img.src = url;
        } catch (e) {
            log("插入失败: " + e.message, "error");
            alert("插入失败: " + e.message);
        }
    }

    // 保存SVG
    function saveSVG() {
        if (!currentSVG) {
            alert("\u8BF7\u5148\u751F\u6210\u4E8C\u7EF4\u7801");
            return;
        }

        try {
            var timestamp = Date.now();
            var filename = currentLayoutId + "_" + timestamp + ".svg";

            if (cs) {
                // CEP环境 - 使用Node.js os.tmpdir()
                var os = require("os");
                var fs = require("fs");
                var tmpDir = os.tmpdir();
                var fullPath = tmpDir + "\\" + filename;
                fs.writeFileSync(fullPath, currentSVG, "utf-8");
                log("SVG\u5DF2\u4FDD\u5B58: " + fullPath, "success");
            } else {
                // 浏览器环境
                var blob = new Blob([currentSVG], { type: "image/svg+xml" });
                var url = URL.createObjectURL(blob);
                var a = document.createElement("a");
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                log("SVG\u5DF2\u4E0B\u8F7D: " + filename, "success");
            }
        } catch (e) {
            log("\u4FDD\u5B58\u5931\u8D25: " + e.message, "error");
            alert("\u4FDD\u5B58\u5931\u8D25: " + e.message);
        }
    }

    // 复制SVG
    function copySVG() {
        if (!currentSVG) {
            alert("\u8BF7\u5148\u751F\u6210\u4E8C\u7EF4\u7801");
            return;
        }

        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(currentSVG).then(function() {
                    log("SVG\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F", "success");
                }).catch(function() {
                    fallbackCopy();
                });
            } else {
                fallbackCopy();
            }
        } catch (e) {
            log("\u590D\u5236\u5931\u8D25: " + e.message, "error");
        }
    }

    function fallbackCopy() {
        var ta = document.createElement("textarea");
        ta.value = currentSVG;
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        try {
            document.execCommand("copy");
            log("SVG\u5DF2\u590D\u5236\uFF08\u56DE\u9000\u65B9\u5F0F\uFF09", "success");
        } catch (e) {
            log("\u590D\u5236\u5931\u8D25", "error");
        }
        document.body.removeChild(ta);
    }

    // ---- 事件绑定 ----

    elConfigToggle.addEventListener("click", function() {
        elConfigContent.classList.toggle("show");
        elToggleIcon.classList.toggle("expanded");
    });

    // 关闭按钮
    document.getElementById("configClose").addEventListener("click", function() {
        elConfigContent.classList.remove("show");
        elToggleIcon.classList.remove("expanded");
    });

    elSaveConfigBtn.addEventListener("click", function() {
        saveConfig();
    });

    elGenerateBtn.addEventListener("click", function() {
        generateTraceQR();
    });

    elLayoutName.addEventListener("keydown", function(e) {
        if (e.key === "Enter" && !isComposing) {
            generateTraceQR();
        }
    });

    // IME 中文输入事件（防止输入法打字过程中触发 Enter）
    elLayoutName.addEventListener("compositionstart", function() {
        isComposing = true;
    });
    elLayoutName.addEventListener("compositionend", function() {
        isComposing = false;
    });

    elInsertBtn.addEventListener("click", insertToAI);
    elSaveSvgBtn.addEventListener("click", saveSVG);
    elCopySvgBtn.addEventListener("click", copySVG);

    // 材质下拉框：选"自定义"时显示输入框，选其他选项时隐藏
    if (elMaterialSelect) {
        elMaterialSelect.addEventListener("change", function() {
            if (this.value === "__custom__") {
                elMaterialCustom.style.display = "block";
                elMaterialCustom.value = "";
                setTimeout(function() { elMaterialCustom.focus(); }, 100);
            } else {
                elMaterialCustom.style.display = "none";
                elMaterialCustom.value = "";
            }
        });
    }

    // ---- 初始化 ----
    loadConfig();
    log("\u8FFD\u6EAF\u4E8C\u7EF4\u7801\u63D2\u4EF6\u5DF2\u5C31\u7EEA");

})();
