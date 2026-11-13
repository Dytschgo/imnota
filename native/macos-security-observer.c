#include <sys/attr.h>
#include <sys/stat.h>
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

/* Strict single-attribute mode: unsupported va_acl is EINVAL, not a missing
 * returned bit. Supported NULL ACL is an explicit zero-length reference.
 * XNU vfs_attrlist.c checks READ_SECURITY before obtaining the attribute.
 */
struct security_reply {
    uint32_t length;
    attrreference_t acl;
};
_Static_assert(sizeof(struct security_reply) == 12, "Unexpected attribute layout");

int main(int argc, char **argv) {
    if (argc != 3 || strcmp(argv[1], "acl") != 0 || argv[2][0] != '/') {
        fputs("Usage: imnota-security-observer acl <absolute-directory>\n", stderr);
        return 2;
    }
    struct stat before = {0}, after = {0};
    if (lstat(argv[2], &before) != 0 || !S_ISDIR(before.st_mode)) {
        fputs("Security observation target is not a physical directory.\n", stderr);
        return 2;
    }
    int descriptor = open(argv[2], O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (descriptor < 0) {
        perror("Could not open directory for security observation");
        return 2;
    }
    int result = 2;
    const char *observation = NULL;
    struct stat opened = {0};
    if (fstat(descriptor, &opened) != 0 || before.st_dev != opened.st_dev ||
        before.st_ino != opened.st_ino || !S_ISDIR(opened.st_mode)) {
        fputs("Directory changed while opening it.\n", stderr);
        goto done;
    }
    struct attrlist request = {0};
    request.bitmapcount = ATTR_BIT_MAP_COUNT;
    request.commonattr = ATTR_CMN_EXTENDED_SECURITY;
    struct security_reply reply = {0};
    if (fgetattrlist(descriptor, &request, &reply, sizeof(reply), FSOPT_REPORT_FULLSIZE) != 0) {
        perror("Could not completely observe the directory ACL");
        goto done;
    }
    if (reply.length < sizeof(reply) || reply.acl.attr_dataoffset != (int32_t)sizeof(attrreference_t) ||
        (uint64_t)reply.length != sizeof(reply) + (uint64_t)reply.acl.attr_length) {
        fputs("Incomplete or invalid directory security result.\n", stderr);
        goto done;
    }
    if (lstat(argv[2], &after) != 0 || opened.st_dev != after.st_dev ||
        opened.st_ino != after.st_ino || opened.st_uid != after.st_uid ||
        opened.st_gid != after.st_gid || opened.st_mode != after.st_mode ||
        opened.st_ctimespec.tv_sec != after.st_ctimespec.tv_sec ||
        opened.st_ctimespec.tv_nsec != after.st_ctimespec.tv_nsec) {
        fputs("Directory security changed during observation.\n", stderr);
        goto done;
    }
    observation = reply.acl.attr_length == 0 ? "no-acl" : "acl";
    result = 0;
done:
    if (close(descriptor) != 0) result = 2;
    if (result == 0 && (puts(observation) == EOF || fflush(stdout) != 0 || ferror(stdout))) return 2;
    return result;
}
