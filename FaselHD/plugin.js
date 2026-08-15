const PluginModule = (() => {
    const mainUrl = "https://hdfilme.win";
    const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

    function getHeaders(referer = null) {
        const headers = {
            "User-Agent": userAgent,
            "Accept-Language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7"
        };
        if (referer) headers["Referer"] = referer;
        return headers;
    }

    // Hilfsfunktion: Sucht nach standardisierten Film-Blöcken im HTML
    function extractItems(html, base) {
        const items = [];
        // Sucht grob nach Links, die Bilder und Titel enthalten (typisch für HDFilme)
        const regex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
        let match;
        
        while ((match = regex.exec(html)) !== null) {
            let url = match[1];
            const innerHtml = match[2];
            
            // Überspringe ungültige Links
            if (url.includes("javascript:") || url.includes("#")) continue;

            const imgMatch = innerHtml.match(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/i);
            const titleMatch = innerHtml.match(/alt=["']([^"']+)["']/i) || innerHtml.match(/<h[2-4][^>]*>([^<]+)<\/h[2-4]>/i) || innerHtml.match(/class=["'][^"']*(?:title|name)[^"']*["'][^>]*>([^<]+)<\//i);

            if (url && imgMatch && titleMatch) {
                if (url.startsWith("/")) url = `${base}${url}`;
                let poster = imgMatch[1];
                if (poster.startsWith("//")) poster = "https:" + poster;
                if (poster.startsWith("/")) poster = `${base}${poster}`;

                const title = titleMatch[1].replace(/<[^>]*>/g, "").trim();

                // Vermeide Duplikate
                if (!items.find(i => i.url === url)) {
                    items.push(new MultimediaItem({
                        title: title,
                        url: url,
                        posterUrl: poster,
                        type: url.includes("serie") || url.includes("season") ? "tv" : "movie"
                    }));
                }
            }
        }
        return items;
    }

    async function getHome(callback) {
        try {
            const res = await http_get(mainUrl, getHeaders());
            const body = res.body || "";
            
            const items = extractItems(body, mainUrl);
            
            if (items.length === 0) {
                return callback({ success: false, errorCode: "HOME_ERROR", message: "Keine Filme auf der Startseite gefunden." });
            }

            callback({ success: true, data: { "Filme & Serien": items } });
        } catch (e) {
            callback({ success: false, errorCode: "HOME_ERROR", message: e.message });
        }
    }

    async function search(query, callback) {
        try {
            // HDFilme nutzt oft /search?keyword= oder /?s=
            const searchUrl = `${mainUrl}/?s=${encodeURIComponent(query)}`;
            const res = await http_get(searchUrl, getHeaders(mainUrl));
            
            const items = extractItems(res.body || "", mainUrl);
            callback({ success: true, data: items });
        } catch (e) {
            callback({ success: false, errorCode: "SEARCH_ERROR", message: e.message });
        }
    }

    async function load(url, callback) {
        try {
            const res = await http_get(url, getHeaders(mainUrl));
            const body = res.body || "";

            // Titel extrahieren
            const titleMatch = body.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || body.match(/<title>([^<]+)<\/title>/i);
            const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, "").trim() : "Unbekannt";
            
            // Beschreibung
            const descMatch = body.match(/<div class=["'](?:description|summary|content)["'][^>]*>([\s\S]*?)<\/div>/i) || body.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
            const description = descMatch ? descMatch[1].replace(/<[^>]*>/g, "").trim() : "";

            // Poster
            const posterMatch = body.match(/<meta property=["']og:image["'] content=["']([^"']+)["']/i);
            const posterUrl = posterMatch ? posterMatch[1] : null;

            // Episoden oder einzelner Film? (Einfacher Fallback: Ein Eintrag für den Film)
            const episodes = [
                new Episode({
                    name: "Film / Episode abspielen",
                    url: url,
                    season: 1,
                    episode: 1,
                    headers: getHeaders(url)
                })
            ];

            const mediaItem = new MultimediaItem({
                title: title,
                url: url,
                posterUrl: posterUrl,
                description: description,
                type: "movie", // Standardmäßig als Film behandeln
                episodes: episodes,
                headers: getHeaders(url)
            });

            callback({ success: true, data: mediaItem });
        } catch (e) {
            callback({ success: false, errorCode: "LOAD_ERROR", message: e.message });
        }
    }

    async function loadStreams(episodeUrl, callback) {
        try {
            const res = await http_get(episodeUrl, getHeaders());
            const body = res.body || "";
            const streams = [];

            // Suche nach iFrames (Video-Playern)
            const iframeRegex = /<iframe[^>]+src=["']([^"']+)["']/gi;
            let iframeMatch;
            
            while ((iframeMatch = iframeRegex.exec(body)) !== null) {
                let iframeUrl = iframeMatch[1];
                if (iframeUrl.startsWith("//")) iframeUrl = "https:" + iframeUrl;

                // Streams aus dem iFrame extrahieren
                const frameRes = await http_get(iframeUrl, getHeaders(episodeUrl));
                const frameBody = frameRes.body || "";
                
                // M3U8 oder MP4 Links im Player-Code finden
                const fileRegex = /['"]([^'"]+\.(?:m3u8|mp4)[^'"]*)['"]/gi;
                let fileMatch;
                
                while ((fileMatch = fileRegex.exec(frameBody)) !== null) {
                    streams.push(new StreamResult({
                        url: fileMatch[1],
                        quality: 720, // Standardwert
                        isM3U8: fileMatch[1].includes(".m3u8"),
                        headers: { "Referer": iframeUrl, "User-Agent": userAgent }
                    }));
                }
            }

            callback({ success: true, data: streams });
        } catch (e) {
            callback({ success: false, errorCode: "STREAM_ERROR", message: e.message });
        }
    }

    globalThis.getHome = getHome;
    globalThis.search = search;
    globalThis.load = load;
    globalThis.loadStreams = loadStreams;
})();

Object.assign(globalThis, PluginModule);