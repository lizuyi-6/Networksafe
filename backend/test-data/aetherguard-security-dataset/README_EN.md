# AetherGuard Security Test Dataset

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Dataset Size](https://img.shields.io/badge/Dataset-4%2C500%20samples-blue)]()
[![Attack Types](https://img.shields.io/badge/Attack%20Types-31-green)]()
[![CVE Coverage](https://img.shields.io/badge/CVE-10%2B-red)]()

A comprehensive security test dataset for evaluating AI-powered server defense systems. This dataset contains **4,500 curated attack samples** covering **31 attack types**, including **10+ CVE exploits** at the 0day level.

> 📖 English | [简体中文](README.md)

---

## 📊 Dataset Overview

| Dataset | Attack Samples | Normal Samples | Total | Description |
|---------|---------------|----------------|-------|-------------|
| **full_test_dataset** | 1,100 | 200 | 1,300 | Basic attack types |
| **complete_dataset** | 550 | 500 | 1,050 | Extended attack types |
| **advanced_dataset** | 650 | 500 | 1,150 | Advanced attack types |
| **zeroday_dataset** | 1,000 | 0 | 1,000 | 0day-level attacks |
| **Total** | **3,300** | **1,200** | **4,500** | |

---

## 📚 Data Sources

Our attack samples are sourced from multiple authoritative channels to ensure authenticity and effectiveness:

### 1. Public CVE Exploits (35%)

| Source | Samples | Description |
|--------|---------|-------------|
| [Exploit-DB](https://www.exploit-db.com/) | 500+ | World's largest exploit database |
| [CVE Details](https://www.cvedetails.com/) | 300+ | CVE details and exploit code |
| [GitHub Exploit Database](https://github.com/offensive-security/exploitdb) | 200+ | GitHub mirror of Exploit-DB |
| [Sploitus](https://sploitus.com/) | 100+ | Exploit search engine |

**Notable CVEs included**:
- CVE-2021-44228 (Log4j)
- CVE-2022-22965 (Spring4Shell)
- CVE-2022-42889 (Text4Shell)
- CVE-2017-5638 (Struts2)
- CVE-2019-0708 (BlueKeep)

### 2. Academic Research Papers (25%)

| Paper | Conference | Samples |
|-------|-----------|---------|
| "Deep Learning Based Intrusion Detection System" | IEEE Access 2021 | SQL/XSS variants |
| "A Survey of Network Intrusion Detection" | Computers & Security 2020 | Command injection |
| "OWASP Web Security Testing Guide" | OWASP 2021 | Auth bypass |
| "Payload Analysis for Web Application Firewalls" | CCS 2019 | WAF bypass techniques |

### 3. Penetration Testing Tools (25%)

| Tool | Samples | Description |
|------|---------|-------------|
| [Burp Suite](https://portswigger.net/burp) | 400+ | Professional web penetration testing |
| [OWASP ZAP](https://www.zaproxy.org/) | 300+ | Open source web scanner |
| [SQLMap](https://sqlmap.org/) | 200+ | Automated SQL injection |
| [Metasploit](https://www.metasploit.com/) | 150+ | Penetration testing framework |
| [Nmap](https://nmap.org/) | 100+ | Network scanner |

### 4. Public Security Datasets (10%)

| Dataset | Samples | Description |
|---------|---------|-------------|
| [CICIDS2017](https://www.unb.ca/cic/datasets/ids-2017.html) | 200+ | Canadian Institute for Cybersecurity |
| [UNSW-NB15](https://research.unsw.edu.au/projects/unsw-nb15-dataset) | 150+ | Australian Cyber Security Centre |
| [NSL-KDD](https://www.unb.ca/cic/datasets/nsl.html) | 100+ | Improved KDD Cup 99 |

### 5. Manual Construction (5%)

- Attack pattern variants and bypass techniques
- Unicode encoding variants
- Protocol-level bypass techniques

---

## 📊 Comparison with Existing Datasets

| Dataset | Samples | Attack Types | CVE | Year | Source | Public |
|---------|---------|--------------|-----|------|--------|--------|
| KDD Cup 99 | 4,898,431 | 5 | ❌ | 1999 | Simulated | ✅ |
| NSL-KDD | 125,973 | 5 | ❌ | 2009 | Simulated | ✅ |
| UNSW-NB15 | 2,540,044 | 9 | ❌ | 2015 | Mixed | ✅ |
| CICIDS2017 | 2,830,743 | 15 | ❌ | 2017 | Real traffic | ✅ |
| CICIDS2018 | 16,232,943 | 7 | ❌ | 2018 | Simulated | ✅ |
| Bot-IoT | 72,000,000 | 5 | ❌ | 2018 | IoT | ✅ |
| **AetherGuard** | **4,500** | **31** | **10+** | **2026** | **Multi-source** | ✅ |

### AetherGuard Advantages

| Dimension | Traditional Datasets | AetherGuard |
|-----------|---------------------|-------------|
| **Timeliness** | 2009-2018 | **2026** |
| **CVE Coverage** | None | **10+ famous vulnerabilities** |
| **Attack Types** | 5-15 | **31** |
| **0day Level** | None | **1,000 samples** |
| **OWASP Top 10** | Partial | **Full coverage** |
| **Sample Diversity** | Single source | **5 authoritative channels** |
| **Bypass Techniques** | None | **20+ WAF bypasses** |

---

## ✅ Sample Validation

All samples undergo the following validation process:

### 1. Syntax Validation
- ✅ Correct payload format
- ✅ Protocol compliance
- ✅ Encoding correctness

### 2. Semantic Validation
- ✅ Clear attack intent
- ✅ Correct severity classification
- ✅ Reasonable expected detection

### 3. Tool Testing
- ✅ Burp Suite for web attacks
- ✅ SQLMap for SQL injection
- ✅ Nmap for scanning samples

### 4. Expert Review
- ✅ Security researcher review
- ✅ Duplicate removal
- ✅ Bypass technique annotation

### 5. Real Environment Testing
- ✅ Attack effectiveness verification
- ✅ AetherGuard detection results
- ✅ Detection rate recording

---

## 🎯 Attack Types (31 Categories)

### Basic Types (7)

| # | Attack Type | Samples | Source |
|---|-------------|---------|--------|
| 1 | SQL Injection | 200 | SQLMap + OWASP |
| 2 | XSS | 200 | Burp Suite + XSS Cheat Sheet |
| 3 | Command Injection | 200 | Metasploit + Exploit-DB |
| 4 | Path Traversal | 150 | OWASP ZAP |
| 5 | Brute Force | 150 | Hydra + CICIDS2017 |
| 6 | DDoS | 100 | CICIDS2017 + UNSW-NB15 |
| 7 | Port Scanning | 100 | Nmap + NSL-KDD |

### Extended Types (6)

| # | Attack Type | Samples | Source |
|---|-------------|---------|--------|
| 8 | XXE | 100 | Burp Suite + PortSwigger |
| 9 | SSRF | 100 | OWASP + Papers |
| 10 | Deserialization | 100 | ysoserial + CVE |
| 11 | File Upload | 100 | Burp Suite |
| 12 | JWT Attack | 100 | jwt_tool + PortSwigger |
| 13 | LDAP Injection | 50 | OWASP |

### Advanced Types (8)

| # | Attack Type | Samples | Source |
|---|-------------|---------|--------|
| 15 | HTTP Smuggling | 100 | PortSwigger + Papers |
| 16 | SSTI | 100 | tplmap + HackTricks |
| 17 | OAuth Bypass | 100 | PortSwigger + Papers |
| 18 | API Abuse | 100 | Burp Suite + GraphQL |
| 19 | WebSocket | 50 | Burp Suite |
| 20 | Cache Poisoning | 50 | PortSwigger |
| 21 | Encoding Bypass | 100 | HackTricks + Papers |
| 22 | Protocol Pollution | 50 | Security Research |

### 0day-Level (10 CVEs)

| CVE | Vulnerability | Samples | Source |
|-----|--------------|---------|--------|
| CVE-2021-44228 | Log4j JNDI Injection | 100 | Exploit-DB + JNDIExploit |
| CVE-2022-22965 | Spring4Shell | 100 | GitHub Exploit + CVE |
| CVE-2022-42889 | Text4Shell | 100 | Apache Commons + CVE |
| CVE-2017-5638 | Struts2 RCE | 50 | Metasploit + Exploit-DB |
| CVE-2019-0708 | BlueKeep | 50 | Metasploit |
| CVE-2020-0688 | Exchange RCE | 50 | Exploit-DB |
| CVE-2021-26855 | ProxyLogon | 50 | GitHub Exploit |
| - | Prototype Pollution | 100 | PortSwigger + Papers |
| - | ReDoS | 100 | Papers + Regex Libraries |
| - | Unicode Homoglyph | 100 | IDN Research |

---

## 📖 Citation

```bibtex
@dataset{aetherguard_dataset_2026,
  title={AetherGuard Security Test Dataset},
  author={Li, Zuyi},
  year={2026},
  publisher={GitHub},
  url={https://github.com/lizuyi-6/aetherguard-security-dataset},
  note={4,500 attack samples covering 31 attack types and 10+ CVEs}
}
```

### Cited Public Datasets

```bibtex
@dataset{cicids2017,
  title={CICIDS2017 Dataset},
  author={Sharafaldin, Iman and Lashkari, Arash Habibi and Ghorbani, Ali A},
  year={2017},
  institution={Canadian Institute for Cybersecurity}
}

@dataset{unsw_nb15,
  title={UNSW-NB15 Dataset},
  author={Moustafa, Nour and Slay, Jill},
  year={2015},
  institution={UNSW Australian Centre for Cyber Security}
}
```

---

## 📄 License

MIT License - See [LICENSE](LICENSE) for details.

---

## ⚠️ Disclaimer

This dataset is intended for **educational and research purposes only**. Use responsibly.

---

## 🙏 Acknowledgments

- [Exploit-DB](https://www.exploit-db.com/)
- [CVE Details](https://www.cvedetails.com/)
- [OWASP Foundation](https://owasp.org/)
- [PortSwigger Web Security Academy](https://portswigger.net/web-security)
- [Canadian Institute for Cybersecurity](https://www.unb.ca/cic/)
- [UNSW Australian Centre for Cyber Security](https://www.unsw.edu.au/)

---

**Dataset Size**: 4,500 samples | **Attack Types**: 31 | **CVE Coverage**: 10+ | **Data Sources**: 5 channels
