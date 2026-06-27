const std = @import("std");

// Build the Zig port of the split-flap board. Links SDL2 + SDL2_ttf and uses
// the Zig standard library's HTTP client for fetching (no ureq equivalent).
//
//     zig build            # debug
//     zig build -Doptimize=ReleaseFast
//     ./zig-out/bin/splitflap_board URL --cols 32 --rows 6 --windowed
pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const mod = b.createModule(.{
        .root_source_file = b.path("src/main.zig"),
        .target = target,
        .optimize = optimize,
    });

    // SDL2 / SDL2_ttf live under Homebrew's prefix on this machine; on a Pi the
    // system paths (/usr/include, /usr/lib) are picked up by the linker anyway.
    mod.addIncludePath(.{ .cwd_relative = "/usr/local/include" });
    mod.addLibraryPath(.{ .cwd_relative = "/usr/local/lib" });
    // Link the dylibs directly. pkg-config is avoided because the SDL2 and
    // SDL2_ttf .pc files each emit `-lSDL2main -lSDL2`, and the duplicate makes
    // dyld refuse to load the binary on macOS.
    mod.linkSystemLibrary("SDL2", .{ .use_pkg_config = .no });
    mod.linkSystemLibrary("SDL2_ttf", .{ .use_pkg_config = .no });
    mod.link_libc = true;

    const exe = b.addExecutable(.{
        .name = "splitflap_board",
        .root_module = mod,
    });

    b.installArtifact(exe);

    const run = b.addRunArtifact(exe);
    run.step.dependOn(b.getInstallStep());
    if (b.args) |args| run.addArgs(args);
    const run_step = b.step("run", "Run the split-flap board");
    run_step.dependOn(&run.step);
}
