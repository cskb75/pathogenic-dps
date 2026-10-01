"""Builds a packed scene's full node tree, with instanced scenes expanded, as the game would instantiate it.

The order matters for anything that runs in `_enter_tree` (top-down, parents
first) or `_ready` (bottom-up, children first): see `walk`.
"""
from extract import clean
from gdres import scene_nodes
from uids import resolve

FLAG_ID_IS_PATH = 1 << 30
FLAG_MASK = (1 << 24) - 1


class Node:
    def __init__(self, name, props=None):
        self.name = name
        self.props = dict(props or {})
        self.children = []
        self.parent = None

    def add(self, child):
        child.parent = self
        self.children.append(child)

    def find(self, path):
        node = self
        for part in [p for p in path.split('/') if p and p != '.']:
            if part == '..':
                node = node.parent
                if node is None:
                    return None
                continue
            node = next((c for c in node.children if c.name == part), None)
            if node is None:
                return None
        return node

    def path_from(self, root):
        parts = []
        node = self
        while node is not None and node is not root:
            parts.append(node.name)
            node = node.parent
        return '/'.join(reversed(parts))

    @property
    def script(self):
        return str(self.props.get('script') or '')


def build(pack, scene, depth=0):
    """The scene's root Node, with every instanced scene inside it expanded."""
    if depth > 12:
        raise RecursionError(scene)
    res = pack.resource(resolve(pack, scene))
    ext = res['ext']
    bundled = res['resources'][-1]['props']['_bundled']
    node_paths = bundled.get('node_paths') or []
    raw = bundled['nodes']
    nodes = scene_nodes(res)
    built = []
    root = None
    i = 0
    for n in nodes:
        # scene_nodes drops the flag bits of `parent`; read them from the raw array.
        parent_raw = raw[i]
        i += 6 + 2 * raw[i + 5]
        i += 1 + raw[i]
        props = {k: clean(v, ext) for k, v in n['props'].items()}
        inst = clean(n['instance'], ext) if n.get('instance') else None
        if parent_raw == -1 or (parent_raw < 0 and not parent_raw & FLAG_ID_IS_PATH):
            parent = None
        elif parent_raw & FLAG_ID_IS_PATH:
            parent = root.find(node_paths[parent_raw & FLAG_MASK]) if root else None
        else:
            parent = built[parent_raw]
        if inst:
            node = build(pack, inst, depth + 1)
            node.name = n['name']
            node.props.update(props)
        elif n.get('type') is None and parent is not None:
            # A node of an instanced scene with properties set from this one.
            node = parent.find(n['name'])
            if node is not None:
                node.props.update(props)
                built.append(node)
                continue
            node = Node(n['name'], props)
        else:
            node = Node(n['name'], props)
        if parent is None and root is None:
            root = node
        elif parent is not None:
            parent.add(node)
        built.append(node)
    return root


def walk(root):
    """Yields ('enter', node) top-down for every node, then ('ready', node) bottom-up, like add_child does."""
    def enter(node):
        yield ('enter', node)
        for c in node.children:
            yield from enter(c)

    def ready(node):
        for c in node.children:
            yield from ready(c)
        yield ('ready', node)

    yield from enter(root)
    yield from ready(root)
