import net from 'net';
import mc from 'minecraft-protocol';

/**
 * Scans the IP address for Minecraft LAN servers and collects their info.
 * @param {string} ip - The IP address to scan.
 * @param {number} port - The port to check.
 * @param {number} timeout - The connection timeout in ms.
 * @param {boolean} verbose - Whether to print output on connection errors.
 * @returns {Promise<Array>} - A Promise that resolves to an array of server info objects.
 */
export function serverInfo(ip, port, timeout = 1000, verbose = false) {
    return new Promise((resolve) => {

        let timeoutId = setTimeout(() => {
            if (verbose)
                console.error(`Timeout pinging server ${ip}:${port}`);
            resolve(null); // Resolve as null if no response within timeout
        }, timeout);

        mc.ping({
            host: ip,
            port
        }, (err, response) => {
            clearTimeout(timeoutId);

            if (err) {
                if (verbose)
                    console.error(`Error pinging server ${ip}:${port}`, err);
                return resolve(null);
            }

            // extract version number from modded servers like "Paper 1.21.4"
            const version = response?.version?.name || '';
            const match = String(version).match(/\d+\.\d+(?:\.\d+)?/);
            const numericVersion = match ? match[0] : null;
            if (verbose && numericVersion !== version) {
                console.log(`Modded server found (${version}), attempting to use ${numericVersion}...`);
            }

            const serverInfo = {
                host: ip,
                port,
                name: response.description.text || 'No description provided.',
                ping: response.latency,
                version: numericVersion
            };

            resolve(serverInfo);
        });
    });
}

/**
 * Scans the IP address for Minecraft LAN servers and collects their info.
 * @param {string} ip - The IP address to scan.
 * @param {boolean} earlyExit - Whether to exit early after finding a server.
 * @param {number} timeout - The connection timeout in ms.
 * @returns {Promise<Array>} - A Promise that resolves to an array of server info objects.
 */
export function findServers(ip, earlyExit = false, timeout = 100) {
    return scanMinecraftPorts({
        startPort: 49000,
        endPort: 65000,
        concurrency: 128,
        earlyExit,
        checkPort: (port) => checkTcpPort(ip, port, timeout),
        inspectPort: (port) => serverInfo(ip, port, 200, false),
    });
}

function checkTcpPort(ip, port, timeout) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        const socket = net.createConnection({ host: ip, port, timeout }, () => {
            socket.end();
            finish(port);
        });
        socket.on('error', () => finish(null));
        socket.on('timeout', () => {
            socket.destroy();
            finish(null);
        });
    });
}

export async function scanMinecraftPorts({
    startPort,
    endPort,
    concurrency = 128,
    earlyExit = false,
    checkPort,
    inspectPort,
}) {
    if (!Number.isInteger(startPort) || !Number.isInteger(endPort) || startPort < 1 || endPort > 65535 || endPort < startPort) {
        throw new TypeError('Minecraft discovery port range is invalid.');
    }
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 512) {
        throw new TypeError('Minecraft discovery concurrency must be between 1 and 512.');
    }
    if (typeof checkPort !== 'function' || typeof inspectPort !== 'function') {
        throw new TypeError('Minecraft discovery requires port check and inspection functions.');
    }

    const servers = [];
    for (let batchStart = startPort; batchStart <= endPort; batchStart += concurrency) {
        const batchEnd = Math.min(endPort, batchStart + concurrency - 1);
        const ports = Array.from({ length: batchEnd - batchStart + 1 }, (_, index) => batchStart + index);
        const results = await Promise.all(ports.map(async (port) => {
            const openPort = await checkPort(port);
            return openPort ? inspectPort(openPort) : null;
        }));
        const discovered = results.filter(Boolean);
        servers.push(...discovered);
        if (earlyExit && discovered.length > 0) return [discovered[0]];
    }
    return servers;
}

/**
 * Gets the MC server info from the host and port.
 * @param {string} host - The host to search for.
 * @param {number} port - The port to search for.
 * @param {string} version - The version to search for.
 * @returns {Promise<Object>} - A Promise that resolves to the server info object.
 */
export async function getServer(host, port, version) {
    let server = null;
    let serverString = "";
    let serverVersion = "";
    
    // Search for server
    if (port == -1)
    {
        console.log(`No port provided. Searching for LAN server on host ${host}...`);
        
        await findServers(host, true).then((servers) => {
            if (servers.length > 0)
                server = servers[0];
        });

        if (server == null)
            throw new Error(`No server found on LAN.`);
    }
    else
        server = await serverInfo(host, port, 1000, true);

    // Server not found
    if (server == null) 
        throw new Error(`MC server not found. (Host: ${host}, Port: ${port}) Check the host and port in settings.js, and ensure the server is running and open to public or LAN.`);

    serverString = `(Host: ${server.host}, Port: ${server.port}, Version: ${server.version})`;

    if (version === "auto") 
        serverVersion = server.version;
    else
        serverVersion = version;
    // Server version unsupported / mismatch
    const isSupported = mc.supportedVersions.some(v => 
        serverVersion === v || (serverVersion.startsWith(v) && serverVersion.charAt(v.length) === '.')
    ); // Checks version or parent version (e.g. if 1.7 is supported then 1.7.2 will be allowed)
     if (!isSupported)
        throw new Error(`MC server was found ${serverString}, but version is unsupported. Supported versions are: ${mc.supportedVersions.join(", ")}.`);
    else if (version !== "auto" && server.version !== version)
        throw new Error(`MC server was found ${serverString}, but version is incorrect. Expected ${version}, but found ${server.version}. Check the server version in settings.js.`);
    else
        console.log(`MC server found. ${serverString}`);

    return server;
}
