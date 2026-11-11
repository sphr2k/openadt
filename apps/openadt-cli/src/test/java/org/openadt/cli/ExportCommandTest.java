package org.openadt.cli;

import org.junit.jupiter.api.Test;
import picocli.CommandLine;

import java.io.ByteArrayOutputStream;
import java.io.PrintWriter;

import static org.junit.jupiter.api.Assertions.assertTrue;

class ExportCommandTest {
    @Test
    void supportsYamlPathAndDryRunOptions() {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        CommandLine line = new CommandLine(new ExportCommand());
        line.setOut(new PrintWriter(out, true));
        line.execute("--help");
        String help = out.toString();
        assertTrue(help.contains("--config"));
        assertTrue(help.contains("--dry-run"));
        assertTrue(help.contains("--refresh"));
    }
}
