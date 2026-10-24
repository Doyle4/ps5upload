/** The network doctor's wording: a catalogue key and English text for every finding
 *  (`lib/netDoctor`'s id and variant), written out so the i18n scripts see them. */

export type Text = readonly [key: string, english: string];
export interface Wording {
  title: Text;
  detail: Text;
  fix?: Text;
}

export const WORDING: Record<string, Wording> = {
  "console_link.wifi": {
    title: ["netdoctor.console_link.wifi.title", "Your PS5 is on Wi-Fi"],
    detail: [
      "netdoctor.console_link.wifi.detail",
      "Expect about {wifi} over Wi-Fi; a network cable gets about {cable}.",
    ],
    fix: [
      "netdoctor.console_link.wifi.fix",
      "Connect the PS5 to your router with a network cable, then set it up under Settings > Network > Settings > Set Up Internet Connection.",
    ],
  },
  "console_link.wired": {
    title: ["netdoctor.console_link.wired.title", "Your PS5 uses a network cable"],
    detail: ["netdoctor.console_link.wired.detail", "The fastest way to reach it."],
  },
  "console_link.helper": {
    title: ["netdoctor.console_link.title", "Your PS5's connection"],
    detail: [
      "netdoctor.console_link.helper.detail",
      "Not checked: the PS5's helper did not answer. Connect to the PS5 first.",
    ],
  },
  "console_link.unknown": {
    title: ["netdoctor.console_link.title", "Your PS5's connection"],
    detail: [
      "netdoctor.console_link.unknown.detail",
      "Not checked: the PS5 did not say which of its connections is in use.",
    ],
  },
  "console_link.engine": {
    title: ["netdoctor.console_link.title", "Your PS5's connection"],
    detail: ["netdoctor.engine", "Not checked: the app's engine did not answer."],
  },
  "host_link.wifi": {
    title: ["netdoctor.host_link.wifi.title", "This computer is on Wi-Fi"],
    detail: [
      "netdoctor.host_link.wifi.detail",
      "Wi-Fi ({iface}) usually gives about {wifi}, less through walls or with other devices busy; a network cable gets about {cable}.",
    ],
    fix: [
      "netdoctor.host_link.wifi.fix",
      "Connect this computer to the router with a network cable.",
    ],
  },
  "host_link.vpn": {
    title: ["netdoctor.host_link.vpn.title", "Traffic to the PS5 goes through a VPN"],
    detail: [
      "netdoctor.host_link.vpn.detail",
      "This computer sends traffic for the PS5 through {iface}, a VPN or tunnel. That slows every transfer and can stop some from working.",
    ],
    fix: [
      "netdoctor.host_link.vpn.fix",
      "Turn the VPN off while you transfer, or let local network traffic bypass it (often called split tunneling or \"allow LAN\").",
    ],
  },
  "host_link.wired": {
    title: ["netdoctor.host_link.wired.title", "This computer uses a network cable"],
    detail: ["netdoctor.host_link.wired.detail", "Through {iface}."],
  },
  "host_link.mobile": {
    title: ["netdoctor.host_link.title", "This computer's connection"],
    detail: ["netdoctor.host_link.mobile.detail", "Not checked on phones and tablets."],
  },
  "host_link.container": {
    title: ["netdoctor.host_link.title", "This computer's connection"],
    detail: [
      "netdoctor.host_link.container.detail",
      "Not checked: this engine runs in a container and only sees the container's own virtual network, not this computer's.",
    ],
  },
  "host_link.virtual": {
    title: ["netdoctor.host_link.title", "This computer's connection"],
    detail: [
      "netdoctor.host_link.virtual.detail",
      "Not checked: the connection ({iface}) is a virtual adapter, so the cable or Wi-Fi behind it cannot be seen.",
    ],
  },
  "host_link.unknown": {
    title: ["netdoctor.host_link.title", "This computer's connection"],
    detail: [
      "netdoctor.host_link.unknown.detail",
      "Not checked: this computer did not say which connection reaches the PS5.",
    ],
  },
  "host_link.engine": {
    title: ["netdoctor.host_link.title", "This computer's connection"],
    detail: ["netdoctor.engine", "Not checked: the app's engine did not answer."],
  },
  "link_speed.slow": {
    title: ["netdoctor.link_speed.slow.title", "A network cable connected at only {mbps} Mb/s"],
    detail: [
      "netdoctor.link_speed.slow.detail",
      "That caps transfers near {ceiling}; a gigabit connection gets about {cable}.",
    ],
    fix: [
      "netdoctor.link_speed.slow.fix",
      "Use a Cat5e or better cable, try another port on the router or switch, and make sure every switch on the way is gigabit.",
    ],
  },
  "link_speed.hop": {
    title: ["netdoctor.link_speed.hop.title", "Something on the way runs at 100 Mb/s"],
    detail: [
      "netdoctor.link_speed.hop.detail",
      "This computer's cable connected at {mbps} Mb/s, but the speed test topped out near {ceiling}, the limit of a 100 Mb/s link.",
    ],
    fix: [
      "netdoctor.link_speed.hop.fix",
      "Check the PS5's cable and the router or switch port it plugs into: use Cat5e or better and a gigabit port.",
    ],
  },
  "link_speed.ok": {
    title: ["netdoctor.link_speed.title", "Cable speed"],
    detail: ["netdoctor.link_speed.ok.detail", "This computer's cable connected at {mbps} Mb/s."],
  },
  "link_speed.not_cable": {
    title: ["netdoctor.link_speed.title", "Cable speed"],
    detail: [
      "netdoctor.link_speed.not_cable.detail",
      "Only measured when this computer uses a network cable.",
    ],
  },
  "link_speed.unknown": {
    title: ["netdoctor.link_speed.title", "Cable speed"],
    detail: [
      "netdoctor.link_speed.unknown.detail",
      "Not checked: this computer did not report its cable speed.",
    ],
  },
  "load_latency.balloons": {
    title: ["netdoctor.load_latency.balloons.title", "Replies slow down while sending"],
    detail: [
      "netdoctor.load_latency.balloons.detail",
      "The PS5 answers in {idle} ms when the network is quiet but {loaded} ms while a file is sent. A router or Wi-Fi link that holds too much data back slows every transfer.",
    ],
    fix: [
      "netdoctor.load_latency.balloons.fix",
      "Use a network cable, move closer to the router, or turn on your router's Smart Queue or QoS setting.",
    ],
  },
  "load_latency.steady": {
    title: ["netdoctor.load_latency.title", "Reply time while sending"],
    detail: [
      "netdoctor.load_latency.steady.detail",
      "Steady: {idle} ms when quiet, {loaded} ms while sending.",
    ],
  },
  "load_latency.no_idle": {
    title: ["netdoctor.load_latency.title", "Reply time while sending"],
    detail: [
      "netdoctor.load_latency.no_idle.detail",
      "Not checked: the PS5's helper did not answer.",
    ],
  },
  "load_latency.no_loaded": {
    title: ["netdoctor.load_latency.title", "Reply time while sending"],
    detail: [
      "netdoctor.load_latency.no_loaded.detail",
      "{idle} ms when quiet. Not timed while sending this time.",
    ],
  },
  "mtu.mismatch": {
    title: ["netdoctor.mtu.mismatch.title", "Packet size (MTU) differs"],
    detail: [
      "netdoctor.mtu.mismatch.detail",
      "The PS5 uses {console} and this computer uses {host}. A mismatch can slow or stall large transfers.",
    ],
    fix: [
      "netdoctor.mtu.mismatch.fix",
      "Use 1500, the usual size, on both: turn off jumbo frames on this computer, and set the PS5's MTU to automatic in its internet connection's advanced settings.",
    ],
  },
  "mtu.match": {
    title: ["netdoctor.mtu.title", "Packet size (MTU)"],
    detail: ["netdoctor.mtu.match.detail", "Both use {mtu}."],
  },
  "mtu.unknown": {
    title: ["netdoctor.mtu.title", "Packet size (MTU)"],
    detail: ["netdoctor.mtu.unknown.detail", "Not compared: one side did not report it."],
  },
  "container.bridged": {
    title: [
      "netdoctor.container.bridged.title",
      "This engine runs in a container on a bridge network",
    ],
    detail: [
      "netdoctor.container.bridged.detail",
      "The PS5 is handed a container address it cannot reach, so Stream installs fail, and the checks of this computer's connection only see the container.",
    ],
    fix: [
      "netdoctor.container.bridged.fix",
      "Run the container with host networking, or set PS5UPLOAD_PKG_HOST_IP to the host's LAN address and publish port 19113.",
    ],
  },
  "container.ok": {
    title: ["netdoctor.container.ok.title", "This engine runs in a container"],
    detail: [
      "netdoctor.container.ok.detail",
      "It gives the PS5 a LAN address. Checks of this computer's connection see the container's view.",
    ],
  },
  "other_work.busy": {
    title: [
      "netdoctor.other_work.busy.title",
      "Other work in the app shares the connection",
    ],
    detail: [
      "netdoctor.other_work.busy.detail",
      "{count} transfers or jobs are running. They share the network and the PS5, so each goes slower.",
    ],
    fix: [
      "netdoctor.other_work.busy.fix",
      "Let them finish, or stop the ones you don't need now, then check again.",
    ],
  },
  "other_work.idle": {
    title: ["netdoctor.other_work.idle.title", "Nothing else is running"],
    detail: [
      "netdoctor.other_work.idle.detail",
      "No other transfers or jobs in the app compete for the connection.",
    ],
  },
  "speed_cap.on": {
    title: ["netdoctor.speed_cap.on.title", "An upload speed limit is on"],
    detail: ["netdoctor.speed_cap.on.detail", "Uploads are held to about {cap} MiB/s."],
    fix: [
      "netdoctor.speed_cap.on.fix",
      "Remove the limit on the Upload screen if you don't need it.",
    ],
  },
  "limit.at_link": {
    title: [
      "netdoctor.limit.at_link.title",
      "Transfers run as fast as this connection allows",
    ],
    detail: [
      "netdoctor.limit.at_link.detail",
      "The speed test measured {up} to the PS5 and {down} back, close to the {ceiling} this connection can do. The connection itself is the limit.",
    ],
  },
  "limit.near_link": {
    title: [
      "netdoctor.limit.near_link.title",
      "Transfers run a little below this connection's best",
    ],
    detail: [
      "netdoctor.limit.near_link.detail",
      "The speed test measured {up} to the PS5 and {down} back; this connection can do about {ceiling}.",
    ],
  },
  "limit.below_link": {
    title: ["netdoctor.limit.below_link.title", "The network is slower than it should be"],
    detail: [
      "netdoctor.limit.below_link.detail",
      "The speed test measured {up} to the PS5 and {down} back, well below the {ceiling} this connection should give.",
    ],
    fix: [
      "netdoctor.limit.below_link.fix",
      "Something else is slowing the network: another device using it, a busy switch or a router setting. Restart the router or switch and try another cable or port.",
    ],
  },
  "limit.drive": {
    title: ["netdoctor.limit.drive.title", "Writing on the PS5 is the slow side"],
    detail: [
      "netdoctor.limit.drive.detail",
      "Reading back from the PS5 ran at {down}, but sending to it only {up}. The network is fine; the PS5 took the data in slowly.",
    ],
    fix: [
      "netdoctor.limit.drive.fix",
      "Free some space on the PS5's drive. For uploads to an external drive, use a faster drive and the PS5's fastest USB port.",
    ],
  },
  "limit.measured": {
    title: ["netdoctor.limit.title", "Speed test"],
    detail: [
      "netdoctor.limit.measured.detail",
      "Measured {up} to the PS5 and {down} back. Not compared with what the connection should do, because one side's connection type is not known.",
    ],
  },
  "limit.busy": {
    title: ["netdoctor.limit.title", "Speed test"],
    detail: [
      "netdoctor.limit.busy.detail",
      "Not run: other transfers are running, and a speed test would only compete with them.",
    ],
  },
  "limit.failed": {
    title: ["netdoctor.limit.title", "Speed test"],
    detail: ["netdoctor.limit.failed.detail", "The speed test did not finish: {error}"],
  },
  "limit.stopped": {
    title: ["netdoctor.limit.title", "Speed test"],
    detail: [
      "netdoctor.limit.stopped.detail",
      "The speed test was stopped before it finished.",
    ],
  },
  "limit.none": {
    title: ["netdoctor.limit.title", "Speed test"],
    detail: ["netdoctor.limit.none.detail", "No speed test was run."],
  },
};
