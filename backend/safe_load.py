"""Load the MoonBoardRNN pickles without letting them run arbitrary code.

Only plain containers and numpy arrays are allowed through.
"""
import io
import pickle

_ALLOWED = {
    ("builtins", "dict"), ("builtins", "list"), ("builtins", "tuple"),
    ("builtins", "set"), ("builtins", "str"), ("builtins", "int"),
    ("builtins", "float"), ("builtins", "bool"), ("builtins", "bytes"),
    ("collections", "OrderedDict"), ("collections", "defaultdict"),
    ("numpy.core.multiarray", "_reconstruct"), ("numpy.core.multiarray", "scalar"),
    ("numpy._core.multiarray", "_reconstruct"), ("numpy._core.multiarray", "scalar"),
    ("numpy", "ndarray"), ("numpy", "dtype"),
    ("numpy.core.numeric", "_frombuffer"), ("numpy._core.numeric", "_frombuffer"),
}


class _Restricted(pickle.Unpickler):
    def find_class(self, module, name):
        if (module, name) in _ALLOWED:
            return super().find_class(module, name)
        raise pickle.UnpicklingError(f"blocked: {module}.{name}")


def load(path):
    with open(path, "rb") as f:
        return _Restricted(io.BytesIO(f.read())).load()
