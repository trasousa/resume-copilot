// Receives forwarded diagnostics-channel events from the main Worker's
// ResumeAgent (agents:lifecycle, agents:rpc, agents:state, ...) with zero
// subscription code needed in the agent itself -- Cloudflare forwards them
// automatically to any Worker listed in the producer's tail_consumers.
// See docs/superpowers/specs/2026-08-16-resume-agent-core-design.md.
export default {
  async tail(events) {
    for (const event of events) {
      for (const msg of event.diagnosticsChannelEvents || []) {
        console.log(JSON.stringify({
          timestamp: msg.timestamp,
          channel: msg.channel,
          message: msg.message,
        }));
      }
    }
  },
};
