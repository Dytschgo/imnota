#include <sys/acl.h>
#include <sys/stat.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <uuid/uuid.h>

/* Only positive, complete observations may authorize shared-parent updates.
 * acl_get_file alone conflates an absent ACL with an observation failure.
 * See Apple's Libc sys/statx_np.c and gen/filesec.c for the property contract.
 */
int main(int argc, char **argv) {
    if (argc != 3 || strcmp(argv[1], "acl") != 0 || argv[2][0] != '/') {
        fputs("Usage: imnota-security-observer acl <absolute-directory>\n", stderr);
        return 2;
    }
    filesec_t security = filesec_init();
    if (security == NULL) {
        fputs("Could not allocate security observation.\n", stderr);
        return 2;
    }
    struct stat metadata = {0};
    uid_t owner;
    mode_t mode;
    uuid_t owner_uuid;
    int result = 2;
    const char *observation = NULL;
    if (lstatx_np(argv[2], &metadata, security) != 0 || !S_ISDIR(metadata.st_mode) ||
        filesec_get_property(security, FILESEC_OWNER, &owner) != 0 || owner != metadata.st_uid ||
        filesec_get_property(security, FILESEC_MODE, &mode) != 0 || mode != metadata.st_mode ||
        filesec_get_property(security, FILESEC_UUID, &owner_uuid) != 0) {
        fputs("Could not completely observe directory security.\n", stderr);
        goto done;
    }
    /* Query presence without allocating/copying an ACL. Even an empty ACL is
     * refused: the caller needs absence, not a policy interpretation of entries.
     */
    errno = 0;
    if (filesec_get_property(security, FILESEC_ACL, NULL) == 0) {
        observation = "acl";
    } else if (errno == ENOENT) {
        observation = "no-acl";
    } else {
        fputs("Could not observe the directory ACL.\n", stderr);
        goto done;
    }
    result = 0;
done:
    filesec_free(security);
    if (result == 0 && (puts(observation) == EOF || fflush(stdout) != 0 || ferror(stdout))) return 2;
    return result;
}
