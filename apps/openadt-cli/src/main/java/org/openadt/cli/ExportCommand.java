package org.openadt.cli;

import org.openadt.config.CliLog;
import picocli.CommandLine.Command;
import picocli.CommandLine.Option;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Callable;

/** Thin launcher for the independent adt-export package. */
@Command(name = "export", mixinStandardHelpOptions = true,
        description = "Export SAP ABAP package trees using YAML configuration")
public class ExportCommand implements Callable<Integer> {
    @Option(names = {"--config", "-c"}, defaultValue = "openadt-export.yaml",
            description = "YAML export plan (default: openadt-export.yaml)")
    String config;

    @Option(names = "--dry-run", description = "Sweep packages and count files without downloading")
    boolean dryRun;

    @Option(names = "--refresh", description = "Download again instead of resuming unchanged local files")
    boolean refresh;

    @Override
    public Integer call() {
        Path binary = findBinary();
        Path script = binary == null ? findScript() : null;
        if (binary == null && script == null) {
            CliLog.error("adt-export binary/script not found. Set OPENADT_EXPORT, install adt-export, "
                    + "or run from a source checkout with Bun.");
            return 1;
        }
        List<String> argv = new ArrayList<>();
        if (binary != null) {
            argv.add(binary.toString());
        } else {
            argv.add(BinaryLocator.resolveBunExecutable());
            argv.add(script.toString());
        }
        argv.add("--config");
        argv.add(config);
        if (dryRun) argv.add("--dry-run");
        if (refresh) argv.add("--refresh");
        return ProcessSpawner.runAndWait(new ProcessBuilder(argv), "adt-export");
    }

    static Path findBinary() {
        String override = System.getenv("OPENADT_EXPORT");
        if (override != null && !override.isBlank()) {
            Path path = Path.of(override.trim()).toAbsolutePath();
            if (Files.isExecutable(path) && Files.isRegularFile(path)) return path;
        }
        String osPath = System.getenv("PATH");
        if (osPath != null) {
            String name = System.getProperty("os.name", "").startsWith("Windows")
                    ? "adt-export.exe" : "adt-export";
            for (String segment : osPath.split(File.pathSeparator)) {
                if (!segment.isBlank()) {
                    Path candidate = Path.of(segment).resolve(name);
                    if (Files.isRegularFile(candidate) && Files.isExecutable(candidate)) return candidate;
                }
            }
        }
        return null;
    }

    static Path findScript() {
        String[] roots = {System.getenv("OPENADT_HOME"), System.getenv("OPENADT_REPO"),
                Path.of("").toAbsolutePath().toString()};
        for (String root : roots) {
            if (root == null || root.isBlank()) continue;
            Path cursor = Path.of(root).toAbsolutePath();
            for (int i = 0; i < 8 && cursor != null; i++, cursor = cursor.getParent()) {
                for (String rel : new String[] {
                        "bin/adt-export.mjs",
                        "packages/adt-export/src/main.ts"
                }) {
                    Path candidate = cursor.resolve(rel);
                    if (Files.isRegularFile(candidate)) return candidate;
                }
            }
        }
        return null;
    }
}
