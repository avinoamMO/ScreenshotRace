# ScreenshotRace: Go-To-Market Strategy

## Positioning

**One-liner:** The screenshot API that races multiple providers and picks the best result automatically.

**Problem:** No single screenshot provider is reliable 100% of the time. Puppeteer chokes on JavaScript-heavy SPAs, third-party APIs get blocked by WAFs, and paywalls block everyone. Developers spend hours building retry logic, fallback chains, and quality checks.

**Solution:** ScreenshotRace fires your URL at 4 providers in parallel, uses AI to evaluate quality, and returns the best screenshot. If a paywall is detected, it automatically attempts bypass strategies. You get one API call, one result, zero headaches.

---

## Target Audience

### Primary: Developers Building Screenshot Features

- SaaS products with link preview / social card generation
- SEO tools that need page snapshots
- Monitoring dashboards (visual regression, uptime checks)
- Web scraping pipelines needing visual confirmation
- QA teams doing cross-browser visual testing

### Secondary: Developer Tool Builders

- Teams building internal tools that render web content
- Agencies building client reporting dashboards
- AI/ML teams collecting training data from websites

### Tertiary: Non-Technical Power Users

- Marketers needing reliable page screenshots for reports
- Content teams archiving web pages
- Compliance teams documenting web presence

---

## Distribution Channels

### 1. npm Registry (Week 1)

Publish the SDK as `screenshot-race-sdk` on npm.

- Clean README with installation instructions
- TypeScript types included
- Working code examples
- Keywords: screenshot, api, puppeteer, browserless, multi-provider

### 2. GitHub Discovery (Week 1-2)

- Detailed README with architecture diagram
- Working demo page on GitHub Pages
- Clear "Deploy Your Own" instructions
- Add topics: `screenshot`, `api`, `lambda`, `puppeteer`, `ai`, `typescript`
- Star-worthy: solve a real pain point developers can relate to

### 3. Community Posts (Week 2-4)

**dev.to article:** "I Built a Screenshot API That Races 4 Providers and Picks the Best One"
- Hook: personal story of unreliable screenshot providers
- Architecture walkthrough with diagram
- Code examples showing the SDK
- Performance benchmarks

**Hacker News:** "Show HN: ScreenshotRace - Multi-provider screenshot API with AI quality scoring"
- Focus on the technical problem and solution
- Open source angle
- Interesting AI quality evaluation approach

**Reddit r/webdev, r/node, r/aws:**
- "How we solved screenshot reliability with multi-provider racing"
- Focus on the problem, not the product

### 4. Curated Lists (Week 3-6)

Submit to:
- awesome-apis
- awesome-screenshots
- awesome-serverless
- awesome-typescript
- public-apis (if hosting a public instance)

### 5. Product Hunt (Month 2)

Launch as a developer tool. Emphasize:
- Open source
- Self-hostable
- AI-powered quality selection
- Multi-provider reliability

---

## Pricing Model

### Self-Hosted (Free)

- Deploy your own instance on AWS
- Pay only AWS costs (Lambda, S3, SQS)
- Estimated cost: ~$0.002-0.01 per screenshot depending on provider usage

### Managed Service (Future)

If demand warrants a hosted version:

| Tier | Screenshots/month | Price | Features |
|------|-------------------|-------|----------|
| Free | 100 | $0 | Puppeteer only, basic quality check |
| Pro | 5,000 | $29/mo | All 4 providers, AI quality, paywall bypass |
| Scale | 50,000 | $149/mo | Priority queue, custom providers, webhook callbacks |
| Enterprise | Unlimited | Custom | SLA, dedicated infrastructure, SSO |

**Per-screenshot overage:** $0.01/screenshot beyond plan limit.

---

## Success Metrics

### Month 1
- 50 GitHub stars
- 100 npm downloads
- 10 forks
- 1 community blog post / mention

### Month 3
- 200 GitHub stars
- 500 npm downloads/week
- 5 contributors
- Listed on 3 awesome-* lists

### Month 6
- 500 GitHub stars
- 2,000 npm downloads/week
- Decision point: launch managed service or keep open-source only

---

## Competitive Landscape

| Service | Providers | AI Quality | Paywall Bypass | Self-Host | Price |
|---------|-----------|------------|----------------|-----------|-------|
| **ScreenshotRace** | 4 (racing) | Yes (Claude) | Yes (automated) | Yes | Free (self-host) |
| Browserless | 1 | No | No | Yes | $0.01-0.05/ss |
| URLBox | 1 | No | No | No | $0.02/ss |
| ScreenshotAPI | 1 | No | No | No | $0.01/ss |
| Puppeteer (raw) | 1 | No | No | Yes | Free + infra |

**Key differentiator:** Nobody else races multiple providers and uses AI to pick the best result. This is the only solution that automatically handles the "what if the screenshot is bad?" problem.

---

## Content Calendar

### Week 1: Launch Prep
- [ ] Polish README and docs
- [ ] Publish SDK to npm
- [ ] Enable GitHub Pages for demo
- [ ] Create demo GIF for README

### Week 2: Soft Launch
- [ ] dev.to article
- [ ] Tweet thread explaining the architecture
- [ ] Post in relevant Discord/Slack communities

### Week 3: Community Push
- [ ] Show HN post
- [ ] Reddit posts (r/webdev, r/node)
- [ ] Submit to awesome-* lists

### Week 4: Feedback & Iterate
- [ ] Collect and respond to GitHub issues
- [ ] Write follow-up article on performance benchmarks
- [ ] Consider Product Hunt timing

### Month 2: Growth
- [ ] Product Hunt launch
- [ ] Add webhook support (commonly requested)
- [ ] Write integration guides for popular frameworks
- [ ] Explore hosted service demand
