#!/usr/bin/env python3
"""
AetherGuard Security Test Suite - Master Runner
Executes all phases of security testing and generates comprehensive report
"""

import subprocess
import sys
import json
import os
from datetime import datetime

# Ensure reports directory exists
os.makedirs("reports", exist_ok=True)

def run_phase(phase_num, script_name):
    """Run a single test phase"""
    print(f"\n{'='*70}")
    print(f"PHASE {phase_num}: Running {script_name}")
    print(f"{'='*70}\n")

    result = {
        "phase": phase_num,
        "script": script_name,
        "start_time": datetime.now().isoformat(),
        "success": False,
        "output": "",
        "error": None
    }

    try:
        proc = subprocess.run(
            [sys.executable, script_name],
            capture_output=True,
            text=True,
            timeout=300,  # 5 minute timeout per phase
            cwd=os.path.dirname(os.path.abspath(__file__))
        )

        result["output"] = proc.stdout
        result["error"] = proc.stderr if proc.stderr else None
        result["success"] = proc.returncode == 0

        print(proc.stdout)
        if proc.stderr:
            print("STDERR:", proc.stderr)

    except subprocess.TimeoutExpired:
        result["error"] = "Phase timed out after 5 minutes"
        print(f"[ERROR] Phase {phase_num} timed out")
    except Exception as e:
        result["error"] = str(e)
        print(f"[ERROR] Phase {phase_num} failed: {e}")

    result["end_time"] = datetime.now().isoformat()
    return result


def compile_final_report(phase_results):
    """Compile all phase results into final report"""

    # Load individual phase reports
    all_results = []

    for phase in phase_results:
        report_file = f"reports/phase{phase['phase']}_results.json"
        if os.path.exists(report_file):
            try:
                with open(report_file, "r") as f:
                    phase_data = json.load(f)
                    all_results.append(phase_data)
            except:
                pass

    # Load attack chain results
    attack_chain_file = "reports/phase5_attack_chain_results.json"
    attack_chain_data = None
    if os.path.exists(attack_chain_file):
        try:
            with open(attack_chain_file, "r") as f:
                attack_chain_data = json.load(f)
        except:
            pass

    # Compile summary
    total_tests = 0
    total_vulnerable = 0
    vulnerabilities_by_severity = {
        "CRITICAL": [],
        "HIGH": [],
        "MEDIUM": [],
        "LOW": []
    }

    for phase_data in all_results:
        if "results" in phase_data:
            for test in phase_data["results"]:
                total_tests += 1
                if test.get("vulnerable"):
                    total_vulnerable += 1
                    severity = test.get("severity", "MEDIUM")
                    if severity in vulnerabilities_by_severity:
                        vulnerabilities_by_severity[severity].append({
                            "id": test.get("test_id"),
                            "name": test.get("name")
                        })

    final_report = {
        "title": "AetherGuard Security Assessment Report",
        "timestamp": datetime.now().isoformat(),
        "executive_summary": {
            "total_tests": total_tests,
            "vulnerabilities_found": total_vulnerable,
            "critical_count": len(vulnerabilities_by_severity["CRITICAL"]),
            "high_count": len(vulnerabilities_by_severity["HIGH"]),
            "medium_count": len(vulnerabilities_by_severity["MEDIUM"]),
            "low_count": len(vulnerabilities_by_severity["LOW"])
        },
        "vulnerabilities_by_severity": vulnerabilities_by_severity,
        "phase_results": all_results,
        "attack_chains": attack_chain_data
    }

    return final_report


def print_summary(report):
    """Print executive summary"""
    print("\n" + "=" * 70)
    print("SECURITY ASSESSMENT SUMMARY")
    print("=" * 70)

    summary = report["executive_summary"]

    print(f"\nTotal Tests Executed: {summary['total_tests']}")
    print(f"Vulnerabilities Found: {summary['vulnerabilities_found']}")

    print("\nSeverity Distribution:")
    print(f"  CRITICAL: {summary['critical_count']}")
    print(f"  HIGH:     {summary['high_count']}")
    print(f"  MEDIUM:   {summary['medium_count']}")
    print(f"  LOW:      {summary['low_count']}")

    if summary['critical_count'] > 0:
        print("\n[!!!] CRITICAL VULNERABILITIES DETECTED:")
        for vuln in report["vulnerabilities_by_severity"]["CRITICAL"]:
            print(f"      - {vuln['id']}: {vuln['name']}")

    if summary['high_count'] > 0:
        print("\n[!!] HIGH SEVERITY VULNERABILITIES:")
        for vuln in report["vulnerabilities_by_severity"]["HIGH"]:
            print(f"     - {vuln['id']}: {vuln['name']}")

    print("\n" + "=" * 70)


def main():
    """Run all security test phases"""
    print("=" * 70)
    print("AetherGuard Security Test Suite")
    print("White-Box Security Assessment")
    print(f"Started: {datetime.now().isoformat()}")
    print("=" * 70)

    # Define test phases
    phases = [
        (1, "test_phase1_auth.py"),
        (2, "test_phase2_injection.py"),
        (3, "test_phase3_websocket.py"),
        (4, "test_phase4_crypto.py"),
        (5, "test_phase5_attack_chain.py"),
    ]

    phase_results = []

    # Run each phase
    for phase_num, script_name in phases:
        result = run_phase(phase_num, script_name)
        phase_results.append(result)

    # Compile final report
    print("\n" + "=" * 70)
    print("Compiling Final Report...")
    print("=" * 70)

    final_report = compile_final_report(phase_results)

    # Save final report
    report_path = "reports/final_security_report.json"
    with open(report_path, "w") as f:
        json.dump(final_report, f, indent=2)

    # Print summary
    print_summary(final_report)

    print(f"\nFinal report saved to: {report_path}")
    print(f"Completed: {datetime.now().isoformat()}")

    return final_report


if __name__ == "__main__":
    main()
